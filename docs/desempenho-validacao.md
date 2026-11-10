# Desempenho — implementação após a 0.4.2

Data: 7 de novembro de 2026.

A aba Desempenho mostra CPU, memória residente, tempo aberto, PID e pressão de
memória. Desde a atualização de 9 de novembro de 2026, a lista agrupa cada app com
seus auxiliares pelo bundle externo e soma CPU/RSS. Processos, marcadores de CPU e
RAM, gráficos e pressão de memória são consultados a cada 1 segundo enquanto a
aba e o painel estiverem visíveis. Os serviços são consultados ao entrar na aba ou
atualizar. A ordenação é feita nos cabeçalhos, com direção reversível; as barras de
memória mostram bytes e porcentagem da RAM total. As
consultas pausam durante confirmações e operações e não invalidam os tokens de
ações. Detalhes e evidências atuais: `docs/desempenho-agrupado-0.4.4.md`.
O agendamento não importa este módulo.

O encerramento normal usa SIGTERM. Forçar encerramento exige uma tentativa real
anterior e nova confirmação para o mesmo processo. Antes do sinal são revalidados
PID, UIDs, executável, início e proteção do próprio app e processos do sistema.
As confirmações expiram, são de uso único e ficam vinculadas ao modo simulação.

Os serviços são restritos a LaunchAgents em execução originados de arquivos
regulares do usuário em sua pasta pessoal. Origem, Label, conteúdo, identidade do
arquivo e processo são revalidados. Descarregar não apaga o plist.

## Validação

- `npm test`: 213 testes passaram, sem falhas. Incluem 21 testes de processos
  e serviços, três verificações novas da integração IPC e testes dos ícones.
- `npm run test:ui`: 131 cenários passaram, sem falhas ou erros no console. Incluem
  34 cenários de Desempenho com fixtures: métricas, ordenação, proteções, foco,
  cancelar/Escape, simulação, força como segundo passo, serviços, erros e respostas
  atrasadas. Temas claro/escuro e painéis 420×660, 320×568 e 420×520 foram conferidos.
- Leitura real do módulo no macOS: 534 processos e dois serviços reconhecidos;
  pressão de memória consultada com sucesso. Alguns LaunchAgents não puderam ser
  validados e foram preservados, com aviso explícito. Essa verificação aceitou
  apenas comandos de leitura e bloqueou sinais e comandos de alteração.
- Os testes de encerramento e descarregamento usaram sinais e launchctl simulados;
  nenhum processo ou serviço real foi encerrado para validar a implementação.

Resultados e imagens: `output/validation/performance-0.4.2/`. As imagens de interface
usam dados fictícios. As prévias `desempenho-icones-*` e `apps-icones-noturno.png`
usam métricas fictícias e ícones reais de quatro aplicativos instalados, lidos e
convertidos sem abrir ou alterar esses aplicativos. Os ícones têm cache limitado
e fallback quando ausentes. A lista ganhou colunas de CPU/memória e linhas alternadas.
Esta etapa altera o código do projeto; não gera novo DMG nem
substitui o aplicativo instalado.
