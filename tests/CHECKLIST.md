# Checklist de testes manuais

Executar após `node tests/run.js` passar. Para cada cenário, registrar: resultado, avisos exibidos e campos marcados como indisponíveis.

## Detecção de página
- [ ] 1. Aba fora do LinkedIn: status "Página incompatível", botão Analisar desabilitado.
- [ ] 2. Feed do LinkedIn (não é URL de publicação): status de aviso, botão desabilitado.
- [ ] 3. URL `linkedin.com/feed/update/urn:li:activity:...`: status "Publicação detectada".
- [ ] 4. URL `linkedin.com/posts/...`: idem.

## Tipos de publicação
- [ ] 5. Post somente texto: tipo "text", texto completo, estatísticas coerentes.
- [ ] 6. Post com imagem: tipo "image", alt das imagens listado (ou "não disponível").
- [ ] 7. Post com vídeo: tipo "video".
- [ ] 8. Post com documento (carrossel PDF): tipo "document".
- [ ] 9. Enquete: tipo "poll".
- [ ] 10. Repost com comentário: tipo "repost", card com autor e texto originais.
- [ ] 11. Post longo truncado ("…mais"): aviso de truncamento; após clicar em "ver mais" na página e usar Atualizar coleta, texto completo.

## Métricas e cobertura
- [ ] 12. Post com "1,2 mil" reações: valor normalizado 1200 com precisão "abbreviated" e valor exibido preservado.
- [ ] 13. Post sem compartilhamentos visíveis: métrica marcada como indisponível, nunca 0 inventado.
- [ ] 14. Post com 100+ comentários sem rolar: aviso de coleta parcial com contagem e percentual; barra de cobertura parcial.
- [ ] 15. Rolar/carregar mais comentários no LinkedIn e clicar em Atualizar coleta: união das amostras, cobertura recalculada, classificações de IA anteriores preservadas.
- [ ] 16. Post com zero comentários: abas renderizam sem erro; análises de comentário indicam amostra vazia.

## Análise
- [ ] 17. Comentários só de emoji e só de marcação: flags corretas e taxa de genéricos coerente.
- [ ] 18. Post em inglês: idioma "en" e análise funcional.
- [ ] 19. Tooltips das notas 0-10 e dos índices mostram justificativa/metodologia.
- [ ] 20. Aba Motivações: todos os blocos marcados como hipótese, com evidência.

## Modo IA
- [ ] 21. IA ativada sem chave: aviso claro, análise local executa normalmente.
- [ ] 22. IA ativada com chave: diálogo de consentimento lista dados enviados/não enviados; Cancelar mantém modo local.
- [ ] 23. Aceitar consentimento: Chrome pede permissão para o host do provedor; negar mantém modo local com aviso.
- [ ] 24. Fluxo completo com chave válida (Anthropic e OpenAI): comentários com tag "IA", narrativa no Relatório, modo "local+ia".
- [ ] 25. Chave inválida: erro legível, sem quebra, resultados locais preservados.
- [ ] 26. Desmarcar "Guardar a chave": após fechar e reabrir o painel, campo de chave vazio.

## Persistência e exportação
- [ ] 27. Fechar e reabrir o painel: última análise restaurada do storage.
- [ ] 28. Limpar dados: estado removido, tela vazia.
- [ ] 29. Exportar JSON, CSV (2), MD e HTML: arquivos abrem corretamente; CSV com acentuação correta no Excel (BOM); HTML legível standalone.

## Robustez
- [ ] 30. Simular quebra de seletor (DevTools: renomear classe de comentário): extração continua, campo ausente vira indisponível, falha listada em diagnostics.selectorFailures no JSON.
