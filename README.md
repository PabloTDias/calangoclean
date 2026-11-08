# CalangoClean

App de barra de menu (Electron) que analisa e limpa o Mac, baseado no `limpar-mac.sh`.

```bash
npm install
npm start
```

Clique no ícone na barra de menu para abrir o painel.

O botão **Limpar** abre a confirmação antes de executar a limpeza.

Em **Ajustes > Avisos sonoros**, ligue ou desligue o **Som de conclusão** e use
**Ouvir som** para uma prévia. Um toque curto de duas notas avisa ao concluir
tarefas manuais, inclusive simulações. Cancelamentos, falhas e atualizações
automáticas ficam silenciosos. A preferência é compartilhada com Duplicados.

## Privacidade (0.4.3)

A aba **Privacidade** detecta navegadores instalados e abre suas opções nativas de
limpeza. Escolha o navegador e clique em **Abrir opções de limpeza** ou **Abrir
navegador**. Confira as instruções, o perfil, o período e os tipos de dados; a
exclusão é confirmada no próprio navegador. A aba não lê o histórico nem apaga
diretamente seus bancos de dados, não remove arquivos baixados e não faz busca por
conteúdo adulto. Não apresenta a abertura dessas opções como uma limpeza concluída.

Os avisos de caches agora têm resumo amigável também na origem dos dados. O motivo
técnico fica no tooltip, nos detalhes do resultado e no histórico. A validação está
em `docs/privacidade-0.4.3.md`.

## Desempenho

A aba **Desempenho** mostra os processos com maior uso de CPU ou memória, o tempo
aberto e a pressão de memória do macOS. Os dados são consultados ao entrar na aba
ou clicar em **Atualizar**; não há monitoramento em segundo plano. A ordenação e a
busca usam a última leitura.
Em **Ordenar por**, escolha **Nome** (A–Z), **CPU** ou **Memória** (maiores primeiro).
A lista de aplicativos para desinstalação também permanece em ordem alfabética.

A lista usa colunas alinhadas de CPU e memória e os ícones dos aplicativos,
como referência do Monitor de Atividade. Processos auxiliares usam o ícone do app
pai; quando o ícone não está disponível, aparece um símbolo genérico. Os ícones
também aparecem na lista do desinstalador, sem alterar as regras de remoção.

**Encerrar…** pede confirmação e envia uma solicitação de encerramento normal
(SIGTERM). Se o mesmo processo continuar aberto, **Forçar encerramento…** permite
uma segunda confirmação antes de SIGKILL, com aviso sobre trabalho não salvo.
Processos do sistema, de outros usuários e do próprio CalangoClean são protegidos.
O aplicativo verifica novamente o dono, o executável e a hora de início antes de agir.

A seção **Serviços da sua sessão** lista LaunchAgents em execução originados de
`~/Library/LaunchAgents`. **Descarregar…** retira o serviço da sessão atual após
confirmação; seu arquivo permanece e ele pode voltar no próximo login. Serviços
da Apple, do CalangoClean ou cuja origem não pôde ser validada são preservados.

As ações respeitam o modo simulação do arquivo de configuração e ficam registradas
no histórico. Não fazem parte do agendamento nem da limpeza de arquivos. A validação
inicial está em `docs/desempenho-validacao.md`; os ajustes atuais estão em
`docs/refinamentos-interface.md`, com imagens e resultados em
`output/validation/refinamentos-0.4.2/`.

## Interface compacta e aparência (0.4.1)

### Ajustes da versão 0.4.2

Na confirmação de limpeza, **Limpar sem fechar navegadores** processa as outras categorias
e preserva os caches dos navegadores. **Fechar e limpar** mantém o fluxo com autorização de
fechamento. O **×** cancela sem limpar; **Esc** também cancela a confirmação.

A aba **Apps** lista aplicativos em `/Applications`, `~/Applications` e `/System/Applications`,
incluindo subpastas de aplicativos e utilitários, sem entrar nos próprios bundles.
A lista usa a rolagem da página e mostra o tempo desde a última abertura registrada
pelo Spotlight; quando essa data não existe, mostra **Último uso não informado**.
Aplicativos em execução aparecem como **Em uso agora**. Apps do macOS são somente leitura.
Busque pelo nome,
selecione um aplicativo e clique em **Desinstalar…** para revisar o tamanho e confirmar
o envio à Lixeira. A função preserva documentos e preferências; não esvazia a Lixeira
nem considera o tamanho movido como espaço já liberado. Aplicativos abertos, do sistema,
o próprio CalangoClean e bundles que exigem desinstalador do fabricante são protegidos.
Use o desinstalador do fabricante quando o aplicativo tiver um, conforme a
[orientação da Apple](https://support.apple.com/pt-br/102610).

A confirmação é de uso único e verifica novamente o aplicativo e o modo de simulação.
O roteiro desta versão está em `docs/teste-de-mesa-0.4.2.md`; resultados e imagens em
`output/validation/0.4.2/`.

O painel tem 420 × 660 px e se adapta à área útil da tela. As abas **Limpeza**, **Dispositivos**,
**Agenda** e **Ajustes** preservam os controles existentes. **Detalhes** expande as descrições;
o disco e os chips abrem as informações completas em Dispositivos. **Duplicados** continua
abrindo uma janela própria, maior e redimensionável.

Em **Exibição**, escolha **Normal** (claro), **Noturno** (escuro) ou **Automático** (acompanha
o macOS). A escolha é salva em `config.json`, também vale para duplicados e não muda o tema
do sistema. Configuração ilegível nunca é sobrescrita. O painel e Duplicados usam
a mesma paleta compartilhada nos três modos. A versão em execução aparece no
rodapé fixo de todas as abas e também em Ajustes.

O botão **Entrar na Seja Calango**, em Ajustes, abre o acesso existente do site no navegador.
É opcional: não bloqueia download ou uso, não recebe senha e não cria uma sessão da conta
dentro do aplicativo.

Validação: `npm test` executa testes de módulos com arquivos temporários; `npm run test:ui`
executa os renderers reais em janelas invisíveis, com APIs e dados de teste, sem acessar
arquivos pessoais, Lixeira, launchd ou rede reais. O resultado e as imagens ficam em
`output/validation/tema-rodape-0.4.3/` no código atual. O registro da versão distribuída
continua em `docs/teste-de-mesa-0.4.2.md`.

## Fotos e arquivos duplicados

O botão **Fotos e arquivos duplicados** abre uma janela própria, redimensionável, com
duas abas. **Fotos duplicadas** busca imagens idênticas. **Arquivos duplicados** busca
documentos, vídeos, áudios e arquivos compactados de tipos permitidos. Cada modo tem suas
próprias pastas e resultados. Escolha as pastas pessoais locais e clique em **Buscar
duplicadas**. A busca compara o conteúdo completo, não apenas o nome, e não altera arquivos.
Fotos parecidas ou editadas não são consideradas cópias exatas.

Revise as miniaturas e os caminhos. Clique em **Manter só esta** na foto que deseja
preservar para selecionar as demais do grupo, ou marque **Mover esta cópia** individualmente.
Você pode trocar a cópia mantida antes de confirmar o envio à Lixeira.
O app preserva pelo menos uma cópia válida por grupo e revalida os arquivos antes de
enviar os escolhidos à **Lixeira**, sem exclusão definitiva como alternativa. O modo
simulação da configuração também é respeitado. A ferramenta não participa do agendamento.

Sistema, aplicativos, fototecas `.photoslibrary`, pacotes, projetos reconhecidos,
pastas de nuvem reconhecidas, links, hardlinks e fotos com arquivos auxiliares ficam
fora dos dois modos. DLLs, bibliotecas, scripts, instaladores, bancos de dados e arquivos
sem extensão não entram na comparação. Arquivos com permissão de execução ou assinatura
de programa também são recusados, mesmo renomeados. A busca lê os bytes para comparação,
sem abrir documentos em aplicativos, executar arquivos ou descompactar seu conteúdo.
As restrições são conservadoras: encontrar bytes iguais não determina se um
arquivo é dispensável. Use **Mostrar no Finder** e revise os locais antes de confirmar.
Para duplicatas dentro da fototeca, use a função Duplicatas do próprio app Fotos.

Mover à Lixeira não libera espaço imediatamente. Uma limpeza posterior da Lixeira
pode apagar essas cópias permanentemente. Os tamanhos exibidos representam os arquivos
selecionados, não uma promessa de espaço físico recuperado.

Para visualizar com fotos e documentos de exemplo, sem acessar arquivos pessoais ou a Lixeira:

```bash
npm run preview:photos
```

A demonstração usa cópias temporárias de imagens do macOS e documentos de exemplo,
sempre em simulação.

## Modo simulação (dryRun)

Desligado por padrão nas novas instalações. Enquanto `"dryRun": true` em `~/Library/Application Support/calangoclean/config.json`,
nada é apagado: o app só mostra quanto seria liberado. O painel não altera isso.
Se o arquivo estiver ilegível, o app mantém a simulação por segurança e não sobrescreve a configuração.
Cada execução, inclusive simulada, é registrada em `history.log` na mesma pasta.

## Categorias

| id | Nível | O que faz |
|---|---|---|
| `caches` | seguro | conteúdo de `~/Library/Caches` |
| `logs` | seguro | conteúdo de `~/Library/Logs` |
| `chromeServiceWorker` | seguro | mede sempre; só limpa com o Chrome fechado |
| `trashOld` | atenção | itens da Lixeira com mais de `trashDays` dias (usa ctime, não mtime) |
| `devCaches` | seguro | `brew cleanup -s`, `npm cache clean --force`, `pip3 cache purge` (só os instalados) |
| `downloadsLarge` | revisar | só lista arquivos > 500 MB e > 60 dias; "Mostrar no Finder" |
| `whatsapp` | manual | só mede e orienta |
| `chromeIndexedDB` | manual | só mede e lista os maiores sites |

O **WhatsApp** acima de 1 GB sobe para a lista principal com o botão **Abrir WhatsApp** (só mede e abre o app; nunca apaga nada dele).

As escolhas (marcado/desmarcado) ficam salvas em `config.json`. `revisar` e `manual` nunca apagam nada.

Pastas protegidas pelo macOS (Lixeira, dados do Chrome, WhatsApp) exigem **Acesso Total ao Disco**
para o app (Ajustes > Privacidade e Segurança). Sem isso o card mostra "sem permissão" em vez de 0.

No card **Lixeira**, o tamanho é o que será excluído, como nas demais categorias, sem repetir esse valor na descrição.
Com **Tudo**, a limpeza usa o comando **Esvaziar Lixeira** do Finder, incluindo a Lixeira dos volumes montados.
O macOS pode pedir autorização para controlar o Finder; sem ela o app mostra **Sem permissão**, com acesso aos ajustes de Automação.
O app verifica o resultado e mostra **Limpeza incompleta**, nome e motivo dos itens restantes, sem presumir que todos estão em uso.
Uma falha de medição aparece como **—** com o motivo; o app não apaga um conjunto cujo tamanho não pôde medir.

Para adicionar uma, crie um arquivo em `src/categories/` e registre em `index.js`.

## Discos externos

Pendrives, SSDs e HDs montados em `/Volumes` aparecem como **chips** abaixo do card do Macintosh HD (nome e espaço livre); clicar no chip abre o detalhe (formato, barra de uso e **Ejetar**).
Ficam de fora o disco do sistema, volumes ocultos, snapshots do Time Machine e imagens `.dmg` montadas. A lista se atualiza
sozinha ao conectar/remover (`fs.watch` em `/Volumes` + polling de 5 s com a janela aberta).

Os cards de discos são **somente leitura**, com a ação de ejetar (`diskutil eject`); se o disco estiver em uso, o painel mostra
o programa que o segura. A remoção direta de arquivos em `/Volumes` continua proibida. A opção **Tudo** da Lixeira usa o
comando nativo do Finder e, como **Esvaziar Lixeira** do macOS, inclui os itens já descartados nos volumes montados.

## Rede

O chip **Rede** mostra a conexão ativa (Wi-Fi, Ethernet ou VPN) e o IP local; clicando nele aparece o **Testar velocidade**. O nome da rede Wi-Fi só aparece quando o macOS o
fornece: ele oculta o SSID de apps sem permissão de Localização, e nesse caso o card mostra só "Wi-Fi".

**Testar velocidade** roda `networkQuality -c` (nativo do macOS 12+) e mostra download, upload e latência. Só roda quando você
clica (consome banda, ~20 s): nunca sozinho e nunca no agendamento.

## Agendamento

Desligado por padrão. Ao ligar no painel (dia e hora), o app grava
`~/Library/LaunchAgents/com.sejacalango.calangoclean.auto.plist` e o carrega com `launchctl bootstrap`
(desligar faz `bootout` e apaga o arquivo). O agente roda `src/cli.js --auto` com o próprio binário
do Electron (`ELECTRON_RUN_AS_NODE`), então não precisa de Node instalado.

- Só executa categorias de nível **seguro** que estejam **marcadas**; `atenção`, `revisar` e `manual` nunca rodam sozinhas.
- Respeita `schedule.minDaysBetween` (5 dias) contando a partir de `lastRun`. **Só limpeza real grava `lastRun`**: simulação nunca grava data, e uma execução real em que nada foi limpo também não.
- Tem `RunAtLoad`: roda ao ligar o agendamento e a cada login. Em simulação isso significa uma simulação (e uma notificação) por login, já que ela não conta para o intervalo; em modo real sai com "nada a fazer" dentro do intervalo.
- Respeita o `dryRun` do `config.json`, registra no `history.log` (origem `auto`) e mostra notificação ao final.
- Teste manual: `node src/cli.js --auto --force` (ignora o intervalo; continua respeitando o dryRun). Log do agente em `auto.log`.
- Em desenvolvimento o plist aponta para esta pasta; se mover o projeto, desligue e ligue de novo.
- O app **nunca descarrega o agendamento sozinho** ao abrir: só ao desligar o interruptor, e toda mudança (`schedule {...}`) fica no `history.log`.
- `config.json`: os padrões só valem quando o arquivo não existe. Com o arquivo existente, só as chaves alteradas são gravadas, e um arquivo ilegível nunca é sobrescrito.

## Build (.dmg)

```bash
npm run dist
```

Gera `dist/CalangoClean-<versão>-universal.dmg` (Intel + Apple Silicon num só app). Sem certificado Apple: o bundle recebe
assinatura *ad-hoc*, que o macOS exige para o app abrir em Apple Silicon. Requer internet na primeira vez (baixa o Electron
de cada arquitetura).

Ao terminar, `dist/` mantém somente o DMG novo, com integridade verificada por `hdiutil`.
Se a geração ou a verificação falhar, os pacotes intermediários e o instalador incompleto
são removidos. Não gerar cópias de build permanentes em `output/build-<versão>`.

Primeira instalação (padrão `dryRun: false`, Lixeira marcada com prazo de 7 dias, agendamento desligado):
1. Abra o `.dmg` e arraste **CalangoClean** para **Applications**. Se já existir,
   escolha **Substituir** para manter uma única instalação.
2. Abra o app. Se o macOS bloquear: Ajustes do Sistema > Privacidade e Segurança > **Abrir Mesmo Assim**
   (ou, no Terminal: `xattr -dr com.apple.quarantine "/Applications/CalangoClean.app"`).
3. Para Lixeira, Chrome e WhatsApp, adicione o **CalangoClean** em Acesso Total ao Disco. O agendamento roda pelo launchd,
   fora do app, e usa a permissão do próprio binário do CalangoClean.
4. Ao mudar o app de lugar, abra-o de novo: ele reaponta o agente do agendamento sozinho.

A partir da versão 0.3.3, a primeira abertura ativa a limpeza real também nas instalações antigas, preservando categorias e agendamento. Essa migração acontece uma única vez (`productionModeVersion: 1`). Uma simulação ativada explicitamente no arquivo depois disso continua sendo respeitada. Configuração ilegível bloqueia a limpeza e não é sobrescrita.

## Ícones

Ícones do [Phosphor Icons](https://phosphoricons.com) (MIT), embutidos em `ui/icons.js`; a licença está em `ui/icons-LICENSE.txt`.
O ícone do app (`build/icon.png`) e o da barra de menu (`assets/`) são gerados por `node scripts/make-icons.js`.

## Avisos de atualização (a partir da 0.3.2)

O app consulta o último release estável de https://github.com/PabloTDias/calangoclean
ao iniciar e a cada 6 horas. Uma versão mais recente com DMG anexado gera um banner
no painel e uma notificação do macOS (uma por versão em cada sessão, se permitida pelo sistema).
O botão **Verificar atualizações** permite consultar manualmente. Sem internet, o app
continua funcionando; consultas automáticas não exibem mensagens de erro.

**Baixar atualização** abre o DMG no navegador padrão. A instalação é manual:
feche o CalangoClean, abra o DMG e escolha **Substituir** ao arrastar o app para Applications.
Mantenha o nome `CalangoClean.app`; não crie cópias com o número da versão. A configuração
existente é preservada. A versão 0.3.1 não possui essa consulta e precisa receber
a primeira atualização manualmente.

Para nossas instalações locais, depois de gerar e abrir o DMG, usar o instalador
reutilizável, com o app fechado (substitua `<versão>` pelo número do DMG):

```bash
npm run install:local -- "/Volumes/CalangoClean <versão>/CalangoClean.app"
```

Ele valida a identidade, versão e assinatura, prepara a cópia e substitui somente
`/Applications/CalangoClean.app`. A instalação anterior fica disponível temporariamente
para reversão se a troca ou a validação falhar. Após a validação, ela é removida junto
com o staging; não é arquivada em `output/backups`. Preferências, histórico e agendamento
ficam nas pastas existentes. Se alguma etapa exigir permissão ou deixar uma pendência
de recuperação/limpeza, o comando informa o caminho; não usa `sudo` nem apaga outras cópias.
Depois, ejete o DMG. Os scripts antigos em `output/validation` são registros históricos e
não devem ser reutilizados nas próximas instalações.

Para publicar: crie um release estável com tag `v<versão>` igual à versão do
`package.json`, anexe `CalangoClean-<versão>-universal.dmg` (ou `CalangoClean.dmg`)
e marque-o como o release mais recente. Rascunhos, pré-lançamentos e releases sem
o DMG não geram aviso. Nenhum token GitHub é incluído no aplicativo.

Testes do aviso: `npm test`.
