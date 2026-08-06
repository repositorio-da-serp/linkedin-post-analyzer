---
title: Política de Privacidade — LinkedIn Post Analyzer (LPA)
---

# Política de Privacidade — LinkedIn Post Analyzer (LPA)

**Última atualização: 06/08/2026**

Esta política descreve como a extensão para Google Chrome **LinkedIn Post Analyzer (LPA)** coleta, usa, armazena e compartilha dados, em conformidade com as políticas de privacidade e uso limitado da Chrome Web Store.

## 1. O que a extensão faz

O LPA lê a publicação do LinkedIn aberta na aba ativa do navegador, quando você clica em "Analisar publicação", e produz uma análise estruturada: dados do post, métricas de engajamento visíveis na página, comentários carregados no momento da leitura, classificação de sentimento, clusters comportamentais e um relatório exportável.

A extensão **não roda em segundo plano** e **não lê nenhuma página automaticamente**. Toda leitura ocorre sob uma ação explícita sua, na aba que já está aberta.

## 2. Quais dados são acessados

Quando você aciona a análise em uma publicação do LinkedIn, a extensão lê, apenas do conteúdo já renderizado na página (nunca por requisição própria ao LinkedIn):

- Texto e metadados da publicação (autor, tipo de conteúdo, texto completo visível).
- Métricas de engajamento exibidas pelo LinkedIn (contagens de reações, comentários, compartilhamentos, visualizações, quando disponíveis).
- Texto, autor e hierarquia dos comentários que já estiverem carregados no DOM da página no momento do clique.

A extensão **não acessa**: cookies, tokens de sessão ou credenciais, histórico de navegação, dados de outras abas ou sites, dados de outros usuários do LinkedIn além do que já é publicamente visível na publicação, ou qualquer informação fora da aba ativa.

## 3. Onde os dados são processados e armazenados

### Modo local (padrão)

Por padrão, toda a análise (extração, cálculo de métricas, classificação de sentimento por regras locais, clusterização) roda **inteiramente no seu navegador**. Nenhum dado da publicação sai do seu computador nesse modo.

O resultado da última análise é salvo em `chrome.storage.local`, um armazenamento local da própria extensão, isolado por padrão do Chrome e não acessível a sites nem a outras extensões. Você pode apagar esse estado a qualquer momento pelo botão "Limpar dados" no painel da extensão.

### Modo IA (opcional)

Se você ativar o modo IA, o texto da publicação e dos comentários carregados (truncados: até 3.000 caracteres do post e até 400 caracteres por comentário), além das métricas agregadas visíveis, são enviados a um provedor de IA de terceiros à sua escolha — **Anthropic (Claude)** ou **OpenAI (GPT)** — usando uma chave de API fornecida por você, para gerar classificação de sentimento e um relatório interpretativo.

Antes de cada envio, a extensão exibe um aviso explícito listando exatamente o que será e o que não será enviado, e a análise só prossegue com sua confirmação. Cookies, tokens e URLs de perfil nunca são incluídos nesse envio.

O uso desses dados pelo provedor de IA escolhido é regido pela política de privacidade do próprio provedor:

- Anthropic: https://www.anthropic.com/legal/privacy
- OpenAI: https://openai.com/policies/privacy-policy

### Chave de API

Se você optar por "Guardar a chave neste navegador", ela é salva localmente em `chrome.storage.local`, no seu próprio perfil do Chrome, e nunca é enviada a nenhum destino além do provedor de IA que você escolheu, como autenticação da chamada. Se essa opção não for marcada, a chave é mantida apenas em memória durante a sessão do painel e é descartada ao fechá-lo.

## 4. Compartilhamento de dados

A extensão não vende, aluga nem compartilha seus dados com anunciantes, corretores de dados ou qualquer parte não mencionada nesta política. O único compartilhamento com terceiros ocorre no modo IA opcional, exclusivamente com o provedor (Anthropic ou OpenAI) que você mesmo escolhe e autoriza, para prestar a funcionalidade de análise que você solicitou.

## 5. Retenção e exclusão de dados

- O estado local (`lpa_state`) é mantido em `chrome.storage.local` até você clicar em "Limpar dados" ou desinstalar a extensão, o que remove automaticamente todos os dados armazenados pela extensão.
- A extensão não mantém nenhum servidor próprio; não há retenção de dados fora do seu navegador, exceto pelo processamento pontual realizado pelo provedor de IA que você escolher no modo opcional, sujeito à política de retenção desse provedor.

## 6. Seus controles

- Toda análise depende de uma ação explícita sua; nada é coletado passivamente.
- O modo IA é opt-in, com aviso de consentimento por análise.
- Você pode revogar a permissão de acesso aos domínios de IA a qualquer momento em `chrome://extensions`.
- Você pode apagar todos os dados locais pelo botão "Limpar dados" no painel.
- Você pode desinstalar a extensão a qualquer momento, o que remove todo o armazenamento local associado a ela.

## 7. Conformidade com a Chrome Web Store

O uso de qualquer dado obtido através desta extensão está em conformidade com a Chrome Web Store User Data Policy, incluindo os requisitos de Uso Limitado (Limited Use): os dados são usados exclusivamente para prestar e melhorar a funcionalidade de análise descrita nesta política e na ficha da extensão, e não para publicidade, venda a terceiros ou qualquer finalidade não divulgada aqui.

## 8. Contato

Dúvidas sobre esta política ou sobre o tratamento de dados desta extensão: **serp.dds.ltda@gmail.com**.

## 9. Alterações nesta política

Caso as práticas de coleta ou uso de dados desta extensão mudem, esta página será atualizada e a data no topo será revisada antes da mudança entrar em vigor, conforme exigido pelas políticas vigentes da Chrome Web Store.
