# Ordenação e avisos sonoros — 7 de novembro de 2026

Desempenho permite Nome, CPU e Memória. Nome usa ordem alfabética em pt-BR;
CPU e Memória mostram os maiores primeiro. Ordenar não coleta novos dados.
Apps também ordena os nomes no renderer, mesmo que a API envie outra ordem.

O botão principal é Limpar e continua abrindo a confirmação existente.

O som de conclusão é um sinal próprio de duas notas, com 0,52 segundo. Pode ser
desligado ou ouvido em Ajustes > Avisos sonoros. A preferência é salva sem alterar
as demais configurações e vale também para a janela de duplicados.

Tarefas manuais: análise, limpeza, atualizar listas por botão, desinstalação,
ações de processos/serviços, análise de pastas, teste de velocidade, ejeção,
busca de duplicados e envio confirmado de cópias. Simulações também avisam.
Atualizações automáticas, inicialização, abertura de abas, ordenação, cancelamentos
e falhas ficam silenciosos. Falhas de áudio não mudam o resultado da tarefa.

Validação: 225 testes de módulos e 151 cenários de interface passaram sem falhas.
Os testes usam reprodução de áudio simulada e incluem preferência desligada,
falha ao salvar, falha de áudio, duplicados, cancelamento e atualizações automáticas.
O WAV é incluído no pacote e desempacotado para reprodução pelo macOS.
A reprodução nativa do arquivo de áudio foi conferida com sucesso.

Resultados e imagens: `output/validation/ordenacao-som-0.4.2/`.
