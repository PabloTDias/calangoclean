# Teste de mesa — CalangoClean 0.4.2

Data: 6 de novembro de 2026. Base: 0.4.1.

## Ajustes

A confirmação de limpeza oferece **Limpar sem fechar navegadores**. Essa opção executa as demais categorias selecionadas e mantém os caches de navegadores. **Fechar e limpar** mantém o consentimento explícito para fechar os navegadores antes de limpar seus caches. O botão de fechar e a tecla Escape cancelam a operação.

A seção **Apps** permite listar, buscar, revisar e enviar um aplicativo à Lixeira. A revisão identifica o aplicativo e exige nova confirmação. Aplicativos protegidos e em uso ficam bloqueados. A desinstalação não remove documentos, preferências ou arquivos de suporte, nem esvazia a Lixeira.

## Método e limites

O roteiro de interface carrega os HTML, CSS e renderers reais em Electron com um preload exclusivo de testes. Usa uma pasta temporária de dados e bloqueia requisições HTTP. Não carrega `src/main.js`, não lê pastas pessoais, não fecha navegadores, não chama a Lixeira real, não desinstala aplicativos, não instala LaunchAgent e não executa testes reais de rede ou ejeção.

Os fluxos de desinstalação usam aplicativos fictícios e tokens de confirmação de uso único. A simulação e a rejeição por mudança de modo são testadas sem alterar aplicativos do computador. Escape é exercitado pelo mesmo evento recebido do processo principal, que intercepta a tecla na aplicação instalada.

## Cobertura

| Área | Verificações |
|---|---|
| Limpeza | Oito categorias, seleção, total, zero bytes, categorias manuais, falha ao salvar e resultado parcial |
| Navegadores | Fechar e limpar; limpar demais categorias sem fechar ou enviar caches de navegador à API; conservar seleção; cancelar e Escape |
| Lixeira | Tudo/7/15/30, nova medição, arquivos vazios, permissões, falha de medição e confirmação invalidada por duplicados |
| Apps | Listagem, busca, estado vazio, seleção, metadados, Finder por ID, proteção, app em uso, revisão, cancelar, simular, falha após revisão, mudança de modo, token novo e erro de listagem |
| Revisão manual | Downloads no Finder, cinco sites IndexedDB e ação WhatsApp |
| Armazenamento | Sete categorias de pastas, gráfico, parcial, analisar, cancelar e revelar por ID |
| Discos externos | Lista, detalhe, ejeção, disco em uso e remoção |
| Rede e Bluetooth | Progresso e resultados, erro sem inventar zero, bateria baixa e leitura ausente |
| Agenda | Sete dias, hora/minuto, erro ao gravar e controles reabilitados |
| Atualizações e conta | Consulta, disponibilidade, erro ao abrir download e login externo opcional |
| Aparência | Normal/Noturno/Automático, evento do sistema, falha ao salvar, propagação às janelas e painéis compactos |
| Duplicados | Escopos por modo, adicionar pasta, progresso/cancelar, grupos, metadados, preservar uma cópia, Finder/Fotos, confirmação, simulação, parcial, vazio e erro |

## Resultado

- 96 cenários de interface passaram, sem falhas e sem erros no console dos renderers.
- Painel conferido em 420 × 660, 320 × 568 e 420 × 520 px; Apps também em 320 × 568 px.
- Confirmados os dois caminhos de limpeza: preservar navegadores e fechar antes de limpar caches.
- A desinstalação simulada, cancelamentos, proteções, app que entrou em uso e confirmação vencida por mudança de modo passaram.
- 167 testes de módulos passaram sem falhas.
- DMG universal Intel/Apple Silicon, integridade (`hdiutil verify`), assinatura ad-hoc (`codesign --verify --deep --strict`) e 13 fontes no ASAR foram validados; nenhum preload de teste está no pacote.
- Foi realizada também uma listagem real somente de leitura: 46 aplicativos encontrados; a verificação não permitia qualquer desinstalação.

## Roteiro executado na interface

| Nº | Cenário | Resultado |
|---:|---|---|
| 1 | Painel: todas as oito categorias e destaque WhatsApp | Passou |
| 2 | Painel: navegação preserva funções e inclui desinstalação de apps | Passou |
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
| 48 | Alternativa informa limpeza sem fechar navegadores | Passou |
| 49 | Confirmação de limpeza mantém foco no diálogo e impede interação ao fundo | Passou |
| 50 | Fechar a confirmação de navegadores continua cancelando a operação | Passou |
| 51 | Limpar sem fechar navegadores executa demais categorias com consentimento explícito | Passou |
| 52 | Alternativa conclui a operação e mantém a opção do cache para a próxima limpeza | Passou |
| 53 | Escape fecha a confirmação sem iniciar uma nova limpeza | Passou |
| 54 | Resultado parcial mantém nome/motivo e estado incompleto | Passou |
| 55 | Falha ao salvar categoria não deixa seleção falsa persistida | Passou |
| 56 | Apps lista os aplicativos sem iniciar desinstalação | Passou |
| 57 | Busca de aplicativos filtra pelo nome | Passou |
| 58 | Busca sem correspondências não permite desinstalar | Passou |
| 59 | Aplicativo em uso mostra motivo e bloqueia a desinstalação | Passou |
| 60 | Aplicativo protegido permanece bloqueado para desinstalar | Passou |
| 61 | Tamanho de aplicativo ainda não medido não é mostrado como zero | Passou |
| 62 | Seleção habilita revisão e Finder usa somente ID permitido | Passou |
| 63 | Desinstalação exige revisão do app e confirmação com cancelar em foco | Passou |
| 64 | Confirmação do app mantém Tab no diálogo e bloqueia o painel de fundo | Passou |
| 65 | Cancelar revisão de aplicativo mantém lista e não desinstala | Passou |
| 66 | Escape cancela a revisão do aplicativo sem ocultar o painel | Passou |
| 67 | Desinstalação simulada passa token e modo e preserva o app | Passou |
| 68 | App que entrou em uso antes da revisão mostra erro sem autorizar remoção | Passou |
| 69 | App que entrou em uso após revisão é preservado com motivo explícito | Passou |
| 70 | Mudança de modo rejeita a confirmação antiga de desinstalação | Passou |
| 71 | Nova revisão depois da mudança de modo usa novo token e simula normalmente | Passou |
| 72 | Erro ao listar aplicativos aparece e libera nova tentativa | Passou |
| 73 | Sair de Apps durante a revisão descarta resposta e não abre modal tardio | Passou |
| 74 | Escape durante revisão pendente descarta resposta sem ocultar o painel | Passou |
| 75 | Aplicativos no painel compacto mantém conteúdo e navegação legíveis sem overflow | Passou |
| 76 | Duplicados abre com modos separados e sem seleção de remoção | Passou |
| 77 | Sem pastas selecionadas a busca fica bloqueada | Passou |
| 78 | Adicionar pasta invalida resultado e seleciona a nova raiz | Passou |
| 79 | Busca mostra progresso e bloqueia troca de modo | Passou |
| 80 | Busca cancelada não habilita envio | Passou |
| 81 | Busca concluída agrupa cópias e mostra metadados | Passou |
| 82 | Manter só esta seleciona demais e preserva uma cópia | Passou |
| 83 | Selecionar todas as cópias é impedido | Passou |
| 84 | Finder e Fotos são ações explícitas e passam IDs/mode | Passou |
| 85 | Envio exige confirmação com quantidade e mantém Lixeira fechada | Passou |
| 86 | Cancelar envio não chama API de Lixeira | Passou |
| 87 | Envio simulado informa que arquivos continuam e limpa seleção | Passou |
| 88 | Limpar seleção mantém grupo e bloqueia ação de envio | Passou |
| 89 | Modo Arquivos seleciona Downloads e mantém raízes próprias | Passou |
| 90 | Arquivos mostram documentos vídeos áudios e compactados sem miniaturas | Passou |
| 91 | Arquivos alterados são preservados e motivo aparece | Passou |
| 92 | Retornar ao modo Fotos restaura escopo sem manter seleção | Passou |
| 93 | Falha de busca exibe erro e não autoriza mover | Passou |
| 94 | Busca sem duplicados mostra estado vazio apropriado | Passou |
| 95 | Janela de duplicados acompanha tema compartilhado | Passou |
| 96 | Janela de duplicados redimensionada mantém controles principais visíveis | Passou |

## Reprodução

```sh
npm test
npm run test:ui
```

O roteiro de interface grava `output/validation/0.4.2/resultado-ui.json` e imagens dos painéis nos temas claro e escuro.

## Instalação e retorno

- Instalado: `/Applications/CalangoClean.app` — versão 0.4.2.
- Backup: `/Users/pablo/Documents/limpa-mac/output/backups/CalangoClean-0.4.1.app` — versão 0.4.1.
- Instalador: `dist/CalangoClean-0.4.2-universal.dmg`.
- SHA-256: `dd35622b9296d1cb174fb55b358c4c110d00883b8729e726333ed51999f71fc0`.
- As preferências do usuário foram preservadas. Para retornar, feche o aplicativo e substitua a cópia em Aplicativos pelo backup.
- Não foi executada desinstalação real nem limpeza de arquivos pessoais para testar. A função só move um app à Lixeira após escolha e confirmação explícitas. Apps com extensões ou helpers privilegiados devem usar seu desinstalador do fabricante.
- Não houve publicação de release no GitHub nesta etapa.
