# Privacidade e mensagens dos caches — 7 de novembro de 2026

A aba lista navegadores instalados, abre suas opções nativas quando disponíveis e
mostra instruções para revisar histórico, cookies, cache e preservação de senhas.
Perfil, período e exclusão são confirmados no navegador. O app não acessa bancos
de navegação, não apaga esses dados diretamente e não busca arquivos pessoais.
Abertura não equivale a limpeza concluída e não emite som de conclusão.

Os comandos aceitam apenas IDs de navegadores conhecidos; caminho do bundle,
identidade e destino fixo são revalidados pelo main. Safari é detectado também
pelo caminho oficial do Cryptex no macOS atual, sem seguir atalhos arbitrários.

O caso ENOTEMPTY de caches agora retorna um resumo simples desde o backend:
"Alguns arquivos foram mantidos". Detalhes técnicos ficam separados e os estados
partial/failed são preservados.

Validação: 231 testes de módulos e 160 cenários de interface passaram sem falhas
ou erros no console. Testes usam fixtures e não abrem navegadores reais nem
executam limpeza de navegação. A detecção real reconheceu Chrome, Firefox, Safari
e Comet sem ler histórico ou cookies. Versão local 0.4.3; sem novo DMG nesta etapa.

Referências de comportamento nativo:
- [Chrome](https://support.google.com/chrome/answer/2392709?hl=pt-BR).
- [Firefox](https://support.mozilla.org/en-US/kb/clear-cookies-and-site-data-firefox).
- [Histórico do Safari](https://support.apple.com/pt-br/guide/safari/sfri47acf5d6/mac).
- [Cookies do Safari](https://support.apple.com/pt-br/guide/safari/sfri11471/mac).

Evidências: `output/validation/privacidade-0.4.3/`.
