# encoding: utf-8
Encoding.default_external = Encoding::UTF_8
# Genera dist/max30102.html: un único archivo con todo el JS/CSS (incluido Three.js) en línea.
# Uso: ruby bundle.rb
dir = __dir__
html = File.read(File.join(dir, 'max30102.html'))

html = html.gsub(%r{<script src="\./([^"?]+)(?:\?[^"]*)?"></script>}) do
  path = File.join(dir, Regexp.last_match(1))
  js = File.read(path).gsub('</script', '<\/script')
  "<script>/* #{Regexp.last_match(1)} */\n#{js}\n</script>"
end

html = html.gsub(%r{<link rel="stylesheet" href="\./([^"?]+)(?:\?[^"]*)?" */?>}) do
  css = File.read(File.join(dir, Regexp.last_match(1)))
  "<style>/* #{Regexp.last_match(1)} */\n#{css}\n</style>"
end

leftover = html.scan(%r{<script src=|<link rel="stylesheet" href=})
abort "Quedaron referencias externas: #{leftover.size}" unless leftover.empty?

Dir.mkdir(File.join(dir, 'dist')) unless Dir.exist?(File.join(dir, 'dist'))
out = File.join(dir, 'dist', 'max30102.html')
File.write(out, html)
puts "#{out} · #{(html.bytesize / 1024.0).round} KB"
