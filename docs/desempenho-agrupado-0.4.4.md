# Desempenho: aplicativos agrupados e consumo ao vivo

Data: 9 de novembro de 2026.

Atualização posterior: o intervalo passou para 500 ms, as ações usam × e o botão
Atualizar foi removido de Desempenho. A pressão de memória usa cache de 5 s.
Veja a validação atual em [Painel e discos](painel-discos-0.4.4.md). O restante
deste documento registra a etapa anterior.

Cada aplicativo aparece em uma linha, agrupado pelo bundle externo `.app` e pelo
usuário. Auxiliares dentro de bundles aninhados pertencem ao aplicativo principal.
A linha soma CPU e memória residente, mostra a quantidade de processos e permite
buscar qualquer PID do grupo. Processos protegidos não recebem ações.

Lista, marcadores, gráficos e pressão de memória compartilham o ciclo de 1 segundo
com a aba e a janela visíveis. CPU dos processos usa a diferença do tempo acumulado
entre leituras; a primeira amostra usa a leitura do macOS. A CPU total continua
normalizada por todos os núcleos. Os serviços só são relidos ao abrir a aba ou
atualizar manualmente. Consultas não se sobrepõem nem invalidam confirmações.

Os cabeçalhos App / processo, CPU e Memória substituem o combo de ordenação. O
segundo clique inverte a direção; a ordem acompanha cada leitura. As linhas e o
foco são preservados ao atualizar ou mover uma linha. Barras de memória mostram a
porcentagem da RAM total, acompanhadas do valor em bytes. Os gráficos de CPU e RAM
guardam até 60 amostras reais do último minuto; não preenchem o passado com dados
fictícios. A pressão do macOS fica no card de memória, com detalhes no tooltip.

Uma falha ao consultar processos preserva os últimos valores e mostra um aviso de
lista desatualizada; os marcadores continuam disponíveis se a leitura deles tiver
sucesso. Uma leitura seguinte recupera a lista automaticamente. Sair da aba,
ocultar o painel e revisar ou executar ações pausa a atualização.

Encerrar um aplicativo revisa os membros apresentados e informa sua quantidade.
O token prende as identidades desses processos. Todos são revalidados antes de
enviar SIGTERM; SIGKILL continua exigindo uma tentativa anterior real e nova
confirmação para cada sobrevivente. Um novo auxiliar nunca herda a autorização
de força de outro processo. Simulação e proteções de usuário/sistema permanecem.

## Validação

- **259 testes unitários passaram, sem falhas**, numa cópia temporária isolada
  dentro da pasta do usuário, removida após a execução. Rodar no SSD externo faz
  27 testes antigos de limpeza recusarem suas próprias fixtures por estarem em
  `/Volumes`; as proteções de produção não foram alteradas. Resultado completo:
  `output/validation/desempenho-agrupado-0.4.4/testes-unitarios-isolados.log`.
- **53 testes de desempenho e IPC passaram diretamente no projeto**, incluindo
  agrupamento, deltas de CPU, concorrência, confirmações preservadas e força após
  saída parcial de um grupo.
- **215 cenários de interface passaram, sem falhas ou erros no console**. Incluem
  os cabeçalhos nos dois sentidos, PID auxiliar, atualização simultânea, barras,
  histórico dos gráficos, foco preservado, falha parcial e recuperação, pausas,
  respostas atrasadas e painéis de 420×660, 320×568 e 420×520 nos dois temas.
- Leitura real do macOS: 607 linhas de processos validadas; Notion (10 processos),
  Chrome (22), VS Code (11) e WhatsApp (2) retornaram uma linha por aplicativo.
  Nenhum processo ou serviço real foi encerrado.

As capturas usam dados fictícios e os mesmos HTML, CSS e renderers do aplicativo.
JSON, logs e imagens: `output/validation/desempenho-agrupado-0.4.4/`.

![Painel com gráficos, cabeçalhos e barras](../output/validation/desempenho-agrupado-0.4.4/desempenho-automatico-normal.png)

Esta entrega altera o projeto. Não foi gerado novo DMG nem substituída a cópia em
`/Applications/CalangoClean.app`.
