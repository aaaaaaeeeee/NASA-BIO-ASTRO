# =============================================================================
# A.R.E.S. · Servidor local + puente USB → navegador (sin selector de puerto)
#
#   ruby bridge.rb            → http://localhost:8765/max30102.html
#   ruby bridge.rb -p 9000    → otro puerto HTTP
#   ruby bridge.rb -d /dev/cu.usbserial-0001   → forzar un puerto serie
#
# - Sirve los archivos de esta carpeta (interfaz).
# - Lee el ESP32 por USB a 115200 baud y reenvía cada línea NDJSON por
#   Server-Sent Events en /bridge/stream (funciona en cualquier navegador).
# - Si desconectas el cable, reintenta solo cada segundo.
# Solo usa la librería estándar de Ruby (incluida en macOS).
# =============================================================================
require 'webrick'
require 'json'

opts = { http: (ENV['PORT'] || 8765).to_i, dev: nil }
ARGV.each_with_index do |a, i|
  opts[:http] = ARGV[i + 1].to_i if a == '-p' && ENV['PORT'].nil?
  opts[:dev] = ARGV[i + 1] if a == '-d'
end

PATTERNS = ['/dev/cu.usbserial*', '/dev/cu.wchusbserial*', '/dev/cu.SLAB_USBtoUART*', '/dev/cu.usbmodem*'].freeze
STATE = { device: nil, connected: false, lines: 0, last: nil, error: nil }
CLIENTS = []
LOCK = Mutex.new

def broadcast(payload)
  LOCK.synchronize do
    CLIENTS.delete_if do |w|
      begin
        w.write(payload)
        false
      rescue StandardError
        w.close rescue nil
        true
      end
    end
  end
end

# ---------------------------------------------------------- lector serie
Thread.new do
  loop do
    dev = opts[:dev] || PATTERNS.flat_map { |p| Dir[p] }.first
    if dev && File.exist?(dev)
      begin
        File.open(dev, 'r+b') do |f|
          # Ajustar velocidad con el puerto ABIERTO (en macOS se pierde al cerrarlo)
          system('stty', '-f', dev, '115200', 'cs8', '-cstopb', '-parenb', 'raw', '-echo', '-crtscts', 'clocal')
          STATE.merge!(device: dev, connected: true, error: nil)
          puts "[puente] leyendo #{dev} @115200"
          f.each_line do |raw|
            line = raw.force_encoding('BINARY').strip
            next if line.empty?
            STATE[:lines] += 1
            STATE[:last] = line[0, 160]
            safe = line.encode('UTF-8', invalid: :replace, undef: :replace, replace: '?')
            broadcast("data: #{safe}\n\n")
          end
        end
      rescue StandardError => e
        STATE[:error] = "#{e.class}: #{e.message}"
        puts "[puente] #{STATE[:error]}"
      end
      STATE[:connected] = false
      broadcast("event: status\ndata: {\"connected\":false}\n\n")
    else
      STATE.merge!(device: nil, connected: false)
    end
    sleep 1
  end
end

# keep-alive para que los proxies/navegador no cierren el stream
Thread.new { loop { sleep 10; broadcast(": ping\n\n") } }

# ------------------------------------------------------------- servidor HTTP
server = WEBrick::HTTPServer.new(Port: opts[:http], DocumentRoot: __dir__, AccessLog: [],
                                 Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN))

server.mount_proc '/bridge/status' do |_req, res|
  res['Content-Type'] = 'application/json'
  res['Cache-Control'] = 'no-store'
  res.body = JSON.generate(STATE.merge(clients: CLIENTS.size))
end

server.mount_proc '/bridge/stream' do |_req, res|
  rd, wr = IO.pipe
  wr.sync = true
  res['Content-Type'] = 'text/event-stream'
  res['Cache-Control'] = 'no-store'
  res['X-Accel-Buffering'] = 'no'
  res.chunked = true
  res.body = rd                       # WEBrick lo envía por trozos a medida que llegan datos
  wr.write("retry: 1000\n: conectado\n\n")
  LOCK.synchronize { CLIENTS << wr }
end

# ------------------------------------------------- proxy NASA (evita CORS)
# Solo reenvía a hosts oficiales de NASA. La clave de API la pone el usuario en la interfaz.
require 'net/http'
require 'uri'
NASA_HOSTS = %w[api.nasa.gov osdr.nasa.gov services.swpc.noaa.gov].freeze # NOAA SWPC: datos GOES que alimentan NASA DONKI
server.mount_proc '/nasa' do |req, res|
  res['Cache-Control'] = 'no-store'
  begin
    target = URI.parse(req.query['url'].to_s)
    raise 'host no permitido' unless target.is_a?(URI::HTTPS) && NASA_HOSTS.include?(target.host)
    http = Net::HTTP.new(target.host, 443)
    http.use_ssl = true
    http.open_timeout = 8
    http.read_timeout = 20
    up = http.request(Net::HTTP::Get.new(target.request_uri, 'Accept' => 'application/json', 'User-Agent' => 'ARES-BioTwin/1.0'))
    res.status = up.code.to_i
    res['Content-Type'] = up['content-type'] || 'application/json'
    %w[X-RateLimit-Remaining X-RateLimit-Limit].each { |h| res[h] = up[h] if up[h] }
    res.body = up.body.to_s
  rescue StandardError => e
    res.status = 502
    res['Content-Type'] = 'application/json'
    res.body = JSON.generate(error: e.message)
  end
end

# ------------------------------------------- proxy Claude (opcional, A.R.E.S. AI Flight Surgeon)
# HTTP directo (el Ruby 2.6 de macOS no puede instalar la gema oficial `anthropic`).
# La clave la pone el usuario en la interfaz y llega en la cabecera X-Claude-Key; solo se reenvía a api.anthropic.com.
server.mount_proc '/llm' do |req, res|
  res['Content-Type'] = 'application/json'
  res['Cache-Control'] = 'no-store'
  begin
    raise 'usa POST' unless req.request_method == 'POST'
    key = req['X-Claude-Key'].to_s.strip
    raise 'falta la clave de Claude' if key.empty?
    http = Net::HTTP.new('api.anthropic.com', 443)
    http.use_ssl = true
    http.open_timeout = 10
    http.read_timeout = 120
    up = Net::HTTP::Post.new('/v1/messages', 'Content-Type' => 'application/json', 'x-api-key' => key,
                             'anthropic-version' => '2026-10-21', 'anthropic-beta' => 'server-side-fallback-2026-07-01')
    up.body = req.body.to_s
    r = http.request(up)
    res.status = r.code.to_i
    res.body = r.body.to_s
  rescue StandardError => e
    res.status = 502
    res.body = JSON.generate(error: { message: e.message })
  end
end

trap('INT') { server.shutdown }
puts "A.R.E.S. → http://localhost:#{opts[:http]}/max30102.html  (puente USB activo)"
server.start
