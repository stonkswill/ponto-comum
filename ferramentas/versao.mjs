// Carimba a versão nos arquivos que o index.html carrega (evita o navegador misturar arquivos novos e velhos em cache).
// Uso: node ferramentas/versao.mjs  (rodar antes de publicar)
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { RAIZ } from './hub.mjs';
const arq = path.join(RAIZ, 'index.html'); let html = fs.readFileSync(arq, 'utf8');
html = html.replace(/(src|href)="((?:js\/[\w.-]+\.js)|style\.css)(?:\?v=[\w]+)?"/g, (_, attr, f) => {
  const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(RAIZ, f))).digest('hex').slice(0, 8);
  return attr + '="' + f + '?v=' + h + '"';
});
fs.writeFileSync(arq, html); console.log('versões carimbadas');
