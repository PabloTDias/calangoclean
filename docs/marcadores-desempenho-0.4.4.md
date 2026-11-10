# Marcadores de desempenho

Data: 9 de novembro de 2026.

Esta entrega foi ampliada com agrupamento de aplicativos, lista ao vivo, gráficos,
barras de memória e ordenação pelos cabeçalhos. O comportamento atual e a validação
estão em [Desempenho agrupado](desempenho-agrupado-0.4.4.md); o texto abaixo registra
a etapa anterior dos marcadores.

A tela Desempenho ganhou dois mostradores inspirados na referência: arcos
semicirculares com dez segmentos, cores do azul ao vermelho, ponteiros animados e
valores numéricos. Os cards acompanham os temas claro e escuro e cabem lado a lado
no painel de 320 px. A animação respeita a preferência por movimento reduzido.

CPU, RAM e pressão de memória são atualizadas automaticamente a cada **1 segundo**
com a aba Desempenho aberta e o painel visível. O monitoramento pausa ao sair da
aba, ocultar a janela ou abrir uma confirmação. Consultas demoradas não se
sobrepõem, e respostas atrasadas de uma sessão anterior são descartadas. Falhas
exibem leitura indisponível e uma nova tentativa acontece no próximo intervalo.

A lista de processos e serviços continua sendo consultada ao abrir a aba ou clicar
em Atualizar. A consulta automática não reconstrói a lista, não invalida as
confirmações de ações e não emite som de conclusão. Buscar e ordenar processos
preserva a última leitura da lista.

- **CPU:** diferença dos contadores de todos os núcleos em uma amostra de 200 ms,
  normalizada entre 0 e 100%. É independente da CPU de cada processo da lista.
- **Memória:** RAM total menos RAM livre, com o total e o valor ocupado em bytes.
  Inclui caches que podem ser liberados pelo macOS. A explicação também está no
  tooltip do card; a pressão de memória do macOS permanece logo abaixo.
- **Falhas:** CPU e RAM podem ficar indisponíveis separadamente. Valores ausentes
  ou inválidos exibem travessão e ocultam o ponteiro, sem mostrar zero ou uma leitura
  anterior. Os mostradores têm nomes e valores acessíveis.

## Validação

- `npm test`: 249 testes passaram, sem falhas. Os novos casos verificam amostragem
  sob demanda, normalização entre núcleos, limites, contadores inválidos e falhas
  independentes de CPU e memória, consulta leve sem invalidar confirmações e
  compartilhamento de amostras simultâneas. O IPC aceita apenas o painel visível.
- `npm run test:ui`: 201 cenários passaram, sem falhas ou erros no console da
  interface. Incluem os mostradores, atualização dos ponteiros, estados
  indisponíveis, limites 0/100, temas e painéis 420×660, 320×568 e 420×520. Os 14
  cenários novos verificam o ciclo de 1 segundo, pausas, retomada, respostas
  atrasadas, consultas demoradas, recuperação após falha e atualização manual.
- Leitura real de métricas no macOS concluída: CPU e RAM válidas, com pressão de
  memória consultada. A verificação bloqueou sinais e usou uma pasta fictícia para
  não consultar os LaunchAgents pessoais.
- As imagens usam dados fictícios. O roteiro de interface usa APIs simuladas.

Resultados: `output/validation/desempenho-automatico-0.4.4/resultado-ui.json`.

## Prévias

![Tema claro](../output/validation/desempenho-automatico-0.4.4/marcadores-normal.png)

![Tema escuro](../output/validation/desempenho-automatico-0.4.4/marcadores-noturno.png)

![Painel compacto](../output/validation/desempenho-automatico-0.4.4/marcadores-compacto.png)

Alterações no código do projeto; esta etapa não gera um novo DMG nem substitui o
aplicativo instalado.
