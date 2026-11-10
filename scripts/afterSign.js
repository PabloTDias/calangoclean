// Depois da assinatura ad-hoc do electron-builder, regrava só a assinatura do app principal com um
// "designated requirement" estável: o macOS (TCC) guarda permissões como Acesso Total ao Disco pelo requisito
// de código, e o padrão ad-hoc (`cdhash`) muda a cada build, o que apagaria a permissão a cada atualização.
// Com o requisito por identificador, a permissão concedida a uma versão vale também para a próxima.
// Os executáveis internos (helpers, frameworks) mantêm a assinatura do electron-builder.
// Troca por certificado Developer ID (roadmap: notarização) torna este passo desnecessário.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REQUIREMENT = 'designated => identifier "com.sejacalango.calangoclean"';

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', `-r=${REQUIREMENT}`, '--preserve-metadata=entitlements,flags,runtime', app], { stdio: 'inherit' });
  const out = execFileSync('/usr/bin/codesign', ['-d', '-r-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  if (!String(out).includes('identifier "com.sejacalango.calangoclean"')) throw new Error('O requisito de assinatura estável não foi aplicado.');
};
