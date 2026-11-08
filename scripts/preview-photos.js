// Demonstração isolada da janela real com fotos e documentos de exemplo em
// uma pasta temporária; não acessa dados pessoais, config, agendamento ou Lixeira.
const { app, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

nativeTheme.themeSource = 'dark';
app.setName('CalangoClean — demonstração');
let controller;
let home;

async function prepare() {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'calangoclean-photos-demo-')));
  await fs.mkdir(path.join(home, 'Pictures', 'Viagem'), { recursive: true });
  await fs.mkdir(path.join(home, 'Downloads'), { recursive: true });
  await Promise.all(['Documents', 'Desktop', 'Movies', 'Music'].map(name => fs.mkdir(path.join(home, name))));
  const examples = [
    ['Big Sur Coastline', 'Praia.jpg', 'Praia — cópia.jpg'],
    ['Big Sur Mountains', 'Montanhas.jpg', 'Montanhas — cópia.jpg'],
    ['Catalina Sunset', 'Pôr do sol.jpg', 'Pôr do sol — cópia.jpg'],
  ];
  for (const [source, name, copy] of examples) {
    const original = path.join(home, 'Pictures', 'Viagem', name);
    await new Promise((resolve, reject) => execFile('/usr/bin/sips', [
      '-s', 'format', 'jpeg', '-Z', '1200',
      `/System/Library/Desktop Pictures/.thumbnails/${source}.heic`, '--out', original,
    ], { timeout: 15000 }, error => error ? reject(error) : resolve()));
    await fs.copyFile(original, path.join(home, 'Downloads', copy));
  }
  await fs.mkdir(path.join(home, 'Downloads', 'Relatórios'));
  const document = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
  const text = Buffer.from('Lista de viagem\n\nDocumentos, carregador e câmera.\nEsta é uma cópia de exemplo para revisar na demonstração.\n');
  const csv = Buffer.from('item,quantidade\nPassagens,2\nHospedagem,1\n');
  for (const [name, contents] of [['Resumo da viagem.pdf', document], ['Lista de viagem.txt', text], ['Despesas.csv', csv]]) {
    const original = path.join(home, 'Downloads', 'Relatórios', name);
    await fs.writeFile(original, contents);
    await fs.copyFile(original, path.join(home, 'Downloads', name));
  }
  const userData = path.join(home, 'electron-data');
  await fs.mkdir(path.join(userData, 'Shared Dictionary', 'cache'), { recursive: true });
  app.setPath('userData', userData);
}

prepare().then(() => app.whenReady()).then(async () => {
  controller = require('../src/photoWindow').create({
    demo: true,
    scannerOptions: { home, trashItem: async () => { throw new Error('A demonstração nunca acessa a Lixeira.'); } },
    loadConfig: async () => ({ dryRun: true }),
    appendHistory: async record => fs.appendFile(path.join(home, 'history.log'), JSON.stringify(record) + '\n'),
  });
  await controller.open();
  console.log(`Demonstração isolada: ${home}`);
}).catch(error => { console.error(error); app.exit(1); });

app.on('before-quit', () => controller?.destroy());
