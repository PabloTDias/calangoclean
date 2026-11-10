# Painel compacto e gráficos dos discos externos

Data: 9 de novembro de 2026.

Desempenho usa × em vermelho discreto para encerrar ou forçar um app. O nome da
ação e do aplicativo continuam no tooltip e no nome acessível; as confirmações
permanecem. A coluna de ação passou de 66 para 26 px, liberando espaço para os
nomes dos aplicativos. O botão Atualizar foi removido desta aba.

CPU, RAM e processos atualizam a cada 500 ms com a aba e a janela visíveis. Não há
consultas sobrepostas; confirmações e operações pausam o monitor. A proteção da
árvore do próprio aplicativo é calculada uma vez por leitura, e a pressão de memória
é reaproveitada durante 5 s. Falha na leitura inicial gera nova tentativa automática.
Serviços são consultados ao entrar na aba. Os gráficos guardam até 120 amostras
reais do último minuto.

500 ms é um compromisso para este painel, não um mínimo universal ou uma promessa
de custo zero. Na medição local de dez consultas, cada amostra levou em média
202,4 ms (incluindo a espera de 200 ms para amostrar CPU). O processo e seus filhos
usaram 0,71 s de CPU em 5,07 s de relógio: aproximadamente 14% de um núcleo,
incluindo a inicialização do Node. Isso não é 14% da capacidade total do Mac.
A medição não inclui o custo de renderização e varia com a quantidade de processos.
Log: `output/validation/desempenho-agrupado-0.4.4/benchmark-500ms.log`.

Em Dispositivos, todos os discos, a rede e o Bluetooth começam recolhidos. O SSD
principal conserva seu gráfico por categorias. Clicar em um disco externo gera um
gráfico de rosca das maiores pastas daquele volume, com arquivos na raiz e espaço
não detalhado separados. Reabrir reutiliza o resultado; Analisar de novo é explícito.
O painel mostra a data, cancelamento e eventuais resultados parciais.

O novo módulo volumeFolders aceita somente IDs resolvidos pela lista atual de
volumes externos. Confere caminho e identidade da montagem no começo e no fim,
ignora symlinks e diretórios de metadados do sistema, e usa du -skPx para não seguir
links nem atravessar outras montagens. Limita a duas consultas du simultâneas,
uma análise de disco por vez, tempo por pasta e entradas na raiz. Cancelar ou
recolher durante a medição interrompe os subprocessos. Resultados de discos
removidos ou substituídos são descartados; o cache é limitado e depende da
identidade do volume. A análise é somente leitura e não entra no agendamento.

Exibição e os controles de Atualizações ficam em Ajustes e atualizações. O rodapé
mantém marca, versão e selo de simulação quando aplicável. Sair volta ao topo com
um único ícone power.

## Validação

- 266 testes unitários passaram numa cópia temporária na pasta do usuário,
  removida após executar. Essa localização evita a recusa das fixtures de limpeza
  em /Volumes sem alterar as proteções de produção.
- 60 testes de desempenho, IPC e gráficos externos passaram diretamente no projeto.
- 220 cenários de interface passaram; gráficos, recolhimento, cache ao reabrir,
  ordenação, pausas, intervalo de 500 ms, temas e tamanhos compactos verificados.
- du nativo validado em uma pasta temporária própria com arquivo fictício, sem
  alterar ou analisar dados pessoais.

Logs, JSON e capturas: `output/validation/painel-discos-0.4.4/`.
A entrega é local; não gera DMG nem substitui /Applications/CalangoClean.app.
