# Paleta compartilhada e versão visível — 7 de novembro de 2026

O painel e Duplicados agora carregam `ui/theme.css`. Fundo, cartões, texto,
bordas, cores de estado e cor principal são compartilhados, nos modos Normal,
Noturno e Automático. Fundos auxiliares de Duplicados usam aliases da mesma
paleta. O fundo nativo da janela acompanha o fundo do conteúdo.

A versão em execução voltou ao rodapé fixo em todas as abas. Ela vem de
`app.getVersion()` pelo IPC de inicialização, sem depender de consultas de rede
ou do número informado por um release remoto. Ajustes mantém a versão completa.

A versão permanece 0.4.3. O projeto já usava 0.4.2; o incremento para 0.4.3 foi
feito pelo Codex na entrega de Privacidade. Não foi encontrado registro local
de uma decisão por 1.3.1.

Validação: 231 testes de módulos e 175 cenários de interface passaram.
A comparação de cores renderizadas cobriu fundos, cartões, textos, bordas e
botões nas duas janelas, nos três modos e nas duas aparências do sistema.
O rodapé foi validado em todas as abas e em 420×660, 320×568 e 420×520, incluindo
um evento de atualização com versão diferente para confirmar a origem local.

Evidências: `output/validation/tema-rodape-0.4.3/`. Testes isolados sem limpeza,
desinstalação ou alterações de arquivos pessoais.
