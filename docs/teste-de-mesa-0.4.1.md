# Teste de mesa — CalangoClean 0.4.1

Data: 6 de novembro de 2026. Base local: 0.4.0; versão instalada anterior: 0.3.5.

## Resultado

- 144 testes de módulos passaram, sem falhas, cancelamentos ou testes ignorados.
- 70 cenários de interface passaram, sem erros no console.
- Painel real: 420 × 660 px; também conferido em 320 × 568 e 420 × 520.
- Duplicados mantém janela própria, maior e redimensionável.
- Normal, Noturno e Automático compartilham a preferência entre as duas janelas. Automático segue o macOS, sem mudar o tema do sistema.
- DMG universal verificado; executável contém x86_64 e arm64.
- Assinatura ad-hoc validada por `codesign --verify --deep --strict`.
- Integridade do DMG aprovada por `hdiutil verify`.
- Onze arquivos de código/UI no ASAR foram comparados byte a byte com as fontes testadas. Nome, versão, entrada e dependências do manifesto foram comparados semanticamente; o empacotador remove metadados de desenvolvimento.
- Pacote distribuído não contém o preload de testes nem as prévias HTML.

## O que mudou

Interface compacta com Limpeza, Dispositivos, Agenda e Ajustes; as funções de disco por pastas, rede, ejeção, Bluetooth, revisão manual, prazos da Lixeira e atualização foram preservadas. Descrições comuns podem ser expandidas; avisos de permissão e bloqueio continuam visíveis.

As preferências são gravadas pela fila já existente do config. Falha ao salvar uma categoria ou aparência restaura a escolha anterior e mostra um aviso. JSON ilegível não é sobrescrito. A aparência não muda o modo de limpeza.

O acesso à Seja Calango é opcional, em Ajustes. Abre `https://sejacalango.com.br/#apps` no navegador, onde a pessoa usa o login existente. O app não recebe senha, token nem e-mail e não mantém uma sessão da plataforma. Não há bloqueio de uso por conta, nem novo formulário de cadastro.

## Método e limites

Os testes de módulos usam diretórios temporários e mocks de serviços do sistema; cobrem comparação de conteúdo, preservação de cópias, links, assinaturas de executáveis, permissões, confirmação, falhas parciais e exclusões de escopo.

O roteiro de interface carrega os HTML, CSS e renderers reais em Electron, com um preload separado que fornece fixtures. Ele não carrega `src/main.js`, não lê as pastas pessoais, não chama a Lixeira real, não instala LaunchAgent, não fecha navegadores e não executa testes reais de rede ou ejeção. Requisições HTTP ficam bloqueadas no roteiro.

A autenticação real no Google/outros provedores, prompts de permissões do macOS, ejeção física de unidades e limpeza real de arquivos pessoais não foram acionados. A cobertura desses caminhos usa revisão de código, testes de módulos e respostas simuladas. A renderização foi inspecionada nos temas claro e escuro; o processo instalado foi iniciado e sua versão foi confirmada.

## Cobertura por área

| Área | Verificações |
|---|---|
| Limpeza | Oito categorias, seleção, marcar/desmarcar tudo, total, zero bytes, falha ao salvar, categorias manuais fora da exclusão |
| Lixeira | Tudo/7/15/30, nova medição, arquivos vazios, permissão, falha de medição, confirmação inválida após duplicados, resultado parcial |
| Navegadores | Consentimento para fechar, preservação quando bloqueado, simulação sem fechamento |
| Revisão manual | Downloads com Finder, cinco sites IndexedDB, WhatsApp destacado e ação ausente quando não instalado |
| Armazenamento | Sete categorias de pastas, gráfico, parcial, analisar, cancelar e revelar por ID |
| Discos externos | Lista completa, detalhe, ejeção, disco em uso, nova tentativa e remoção |
| Rede | Somente por clique, progresso, download/upload/latência e erro sem inventar zero |
| Bluetooth | Nome/tipo, bateria, bateria baixa, leitura ausente e agrupamento |
| Agenda | Sete dias, hora/minuto, última limpeza, erro ao gravar, controles reabilitados e apenas chaves permitidas |
| Atualizações | Versão, consulta, disponibilidade e erro de download |
| Aparência | Normal/Noturno/Automático, evento do sistema, persistência, config inválido, falha ao salvar, propagação a duplicados |
| Duplicados | Pastas próprias por modo, adicionar, progresso/cancelar, grupos, metadados, uma cópia preservada, Finder/Fotos, confirmação, simulação, parcial, vazio e erro |
| Conta | Acesso externo opcional, URL fixa, IPC restrito ao painel; nenhum envio de credenciais pelo app |
| Instalação | Versão, arquiteturas, assinatura, integridade, ASAR, backup e processo iniciado |

## Roteiro executado na interface

| Nº | Cenário | Resultado |
|---:|---|---|
| 1 | Painel: todas as oito categorias e destaque WhatsApp | Passou |
| 2 | Painel: navegação preserva limpeza, dispositivos, agenda e ajustes | Passou |
| 3 | Inicialização não inicia limpeza, busca de pastas ou teste de rede | Passou |
| 4 | Total inicial e seleção correspondem aos dados medidos | Passou |
| 5 | Marcar tudo inclui as cinco categorias interativas | Passou |
| 6 | Desmarcar tudo zera o total e bloqueia a limpeza | Passou |
| 7 | Revisão manual mantém arquivos Finder e cinco sites | Passou |
| 8 | Ações manuais passam por APIs explícitas sem limpar dados | Passou |
| 9 | WhatsApp não instalado oculta a ação Abrir | Passou |
| 10 | Lixeira: prazo Tudo remede e permanece selecionado | Passou |
| 11 | Lixeira: prazo 7 dias remede e permanece selecionado | Passou |
| 12 | Lixeira: prazo 15 dias remede e permanece selecionado | Passou |
| 13 | Lixeira: prazo 30 dias remede e permanece selecionado | Passou |
| 14 | Lixeira com arquivo vazio elegível habilita ação em 0 B | Passou |
| 15 | Falha de medição exibe travessão e impede exclusão | Passou |
| 16 | Permissão de disco mostra banner e tamanho desconhecido | Passou |
| 17 | Dar acesso usa o destino de privacidade correto | Passou |
| 18 | Autorização de Automação é diferenciada da permissão de disco | Passou |
| 19 | Simulação: confirmação informa total e Tudo sem fechar navegadores | Passou |
| 20 | Cancelar confirmação não invoca limpeza | Passou |
| 21 | Resultado simulado preserva informação nada apagado | Passou |
| 22 | Revisão de duplicados invalida confirmação antiga da Lixeira | Passou |
| 23 | Disco expande sete pastas e mantém indicação parcial | Passou |
| 24 | Mostrar pasta usa apenas ID permitido | Passou |
| 25 | Cancelar medição de pastas conserva o resultado anterior | Passou |
| 26 | Teste de rede só por clique e com progresso | Passou |
| 27 | Rede mostra download upload e latência | Passou |
| 28 | Falha de rede não vira velocidade zero | Passou |
| 29 | Ejeção em uso exibe motivo e permite tentar de novo | Passou |
| 30 | Remoção de volume fecha seu detalhe e preserva a rede | Passou |
| 31 | Bluetooth contém bateria baixa e dispositivo sem leitura | Passou |
| 32 | Agenda aceita sete dias e hora/minuto e só altera chaves explícitas | Passou |
| 33 | Erro de agenda aparece e controles são reabilitados | Passou |
| 34 | Atualizações informa versão atual sem falso download | Passou |
| 35 | Nova versão exibe banner e botão download | Passou |
| 36 | Erro ao abrir atualização preserva mensagem explícita | Passou |
| 37 | Aparência normal aplica seletor e esquema | Passou |
| 38 | Aparência noturno aplica seletor e esquema | Passou |
| 39 | Aparência automatico aplica seletor e esquema | Passou |
| 40 | Automático reage ao evento de aparência do sistema | Passou |
| 41 | Erro ao salvar tema restaura preferência anterior e informa falha | Passou |
| 42 | Login Seja Calango é opcional e abre somente por pedido | Passou |
| 43 | Modo noturno mantém superfícies com fundo escuro | Passou |
| 44 | Painel 420x660: sem overflow horizontal e botões principais visíveis | Passou |
| 45 | Painel 320x568: sem overflow horizontal e botões principais visíveis | Passou |
| 46 | Painel 420x520: sem overflow horizontal e botões principais visíveis | Passou |
| 47 | Limpeza real simulada pede consentimento explícito para fechar navegador | Passou |
| 48 | Resultado parcial mantém nome/motivo e estado incompleto | Passou |
| 49 | Falha ao salvar categoria não deixa seleção falsa persistida | Passou |
| 50 | Duplicados abre com modos separados e sem seleção de remoção | Passou |
| 51 | Sem pastas selecionadas a busca fica bloqueada | Passou |
| 52 | Adicionar pasta invalida resultado e seleciona a nova raiz | Passou |
| 53 | Busca mostra progresso e bloqueia troca de modo | Passou |
| 54 | Busca cancelada não habilita envio | Passou |
| 55 | Busca concluída agrupa cópias e mostra metadados | Passou |
| 56 | Manter só esta seleciona demais e preserva uma cópia | Passou |
| 57 | Selecionar todas as cópias é impedido | Passou |
| 58 | Finder e Fotos são ações explícitas e passam IDs/mode | Passou |
| 59 | Envio exige confirmação com quantidade e mantém Lixeira fechada | Passou |
| 60 | Cancelar envio não chama API de Lixeira | Passou |
| 61 | Envio simulado informa que arquivos continuam e limpa seleção | Passou |
| 62 | Limpar seleção mantém grupo e bloqueia ação de envio | Passou |
| 63 | Modo Arquivos seleciona Downloads e mantém raízes próprias | Passou |
| 64 | Arquivos mostram documentos vídeos áudios e compactados sem miniaturas | Passou |
| 65 | Arquivos alterados são preservados e motivo aparece | Passou |
| 66 | Retornar ao modo Fotos restaura escopo sem manter seleção | Passou |
| 67 | Falha de busca exibe erro e não autoriza mover | Passou |
| 68 | Busca sem duplicados mostra estado vazio apropriado | Passou |
| 69 | Janela de duplicados acompanha tema compartilhado | Passou |
| 70 | Janela de duplicados redimensionada mantém controles principais visíveis | Passou |

## Reprodução

```sh
npm test
npm run test:ui
```

Os resultados detalhados estão em `output/validation/0.4.1/testes-modulos.txt`, `testes-interface.txt`, `resultado-ui.json` e `resumo-validacao.json`; as imagens de QA estão na mesma pasta.

## Instalação e retorno

- Instalado: `/Applications/CalangoClean.app` — 0.4.1.
- Backup anterior: `/Users/pablo/Documents/limpa-mac/output/backups/CalangoClean-0.3.5.app`.
- Instalador: `dist/CalangoClean-0.4.1-universal.dmg`.
- SHA-256: `205df209e0ac38e1d042a5ab34159efae4e610fe88d14a3de97c6c78ee263378`.
- Para retornar, feche o CalangoClean e substitua o aplicativo em Aplicativos pela cópia do backup. A pasta de preferências do usuário não foi substituída.
- Não foi publicado release no GitHub nesta etapa.
