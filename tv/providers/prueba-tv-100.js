// Plugin de prueba: devuelve siempre una fuente fija, para saber si la app ejecuta plugins.
function getStreams(id, type, season, episode) {
  return Promise.resolve([{
    name: 'PRUEBA TV: el plugin SI corre',
    title: 'Plugin de prueba v1.0.0 (id=' + id + ', tipo=' + type + ')',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    quality: 'Prueba',
    provider: 'PruebaTV'
  }]);
}
module.exports = { getStreams: getStreams };
