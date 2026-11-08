# Refinamentos da interface — 7 de novembro de 2026

- Apps usa a rolagem da página inteira. Lista /Applications, ~/Applications e
  /System/Applications, incluindo subpastas de até quatro níveis, sem percorrer
  bundles nem symlinks. Apps do sistema são somente leitura, inclusive no backend.
- Último uso vem da última abertura registrada pelo Spotlight. Ausência da data
  aparece como "Último uso não informado"; apps abertos aparecem como "Em uso agora".
- Desempenho mostra apenas processos que podem ser encerrados e serviços que
  podem ser descarregados. As verificações de segurança continuam no backend.
- Dispositivos abre as seções expandidas, usando o último resultado de pastas.
  Análise de pastas e teste de velocidade continuam dependendo de seus botões.
- A limpeza resume códigos técnicos em linguagem simples, mantendo o diagnóstico
  no tooltip, nos detalhes do resultado e no histórico. Resultados parciais e
  bloqueios de medição continuam explícitos.

Validação: 219 testes de módulos e 136 cenários de interface passaram sem falhas.
Os renderers reais foram exercitados com fixtures em 420×660, 320×568 e 420×520.
Testes de rolagem alcançam o último de 35 apps fictícios e preservam o rodapé.

Na leitura real deste Mac, foram encontrados 113 apps, dos quais 69 protegidos,
com data de último uso disponível para 26. A verificação não autorizava remover
aplicativos. Não houve limpeza, desinstalação, encerramento de processos ou
descarregamento de serviços reais para testar esses ajustes.

Evidências: `output/validation/refinamentos-0.4.2/`. A versão de desenvolvimento
foi reiniciada para conferência local; o aplicativo instalado não foi substituído.
