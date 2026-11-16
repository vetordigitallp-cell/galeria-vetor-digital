# Galeria Vetor Digital — como colocar no ar

## MODO ATUAL: só Netlify (sem Supabase)

Nesta primeira etapa **não há Supabase**. Tudo fica no Netlify:

- **Netlify Blobs** (armazenamento do próprio Netlify) guarda eventos, fotos, clientes, pedidos e histórico de pagamentos.
- As **funções do Netlify** fazem o checkout da InfinitePay, recebem o webhook, conferem o pagamento e liberam os originais.
- O **painel** (`/admin`) tem um único acesso, o do dono, definido por variáveis de ambiente.

O Supabase continua suportado. Se um dia você preencher `SUPABASE_URL` e as chaves no Netlify (e rodar `supabase/schema.sql`), o site passa a usar o Supabase. Os dados do Netlify Blobs **não** são migrados sozinhos.

### Passo 1 — Código no GitHub
O Netlify publica as funções a partir do repositório. Arrastar a pasta no navegador publica só as páginas, sem pagamento.

### Passo 2 — Site no Netlify
**Add new project → Import an existing project → GitHub →** este repositório. O `netlify.toml` já define tudo (pasta `galeria-vetor-digital`, funções em `netlify/functions`).

### Passo 3 — Variáveis de ambiente
Em **Project configuration → Environment variables**:

| Variável | Valor | Secreta? |
|---|---|---|
| `INFINITEPAY_HANDLE` | sua InfiniteTag, sem `$` | não |
| `INFINITEPAY_API_KEY` | chave `inchk_...` da InfinitePay | **SIM** — marque *Contains secret values* |
| `ADMIN_EMAIL` | o e-mail que você vai usar para entrar no painel | não |
| `ADMIN_PASSWORD` | senha forte, mínimo 10 caracteres | **SIM** |
| `SITE_URL` | **deixe sem criar.** O Netlify já informa o endereço principal do site (variável automática `URL`), que passa a ser o domínio quando ele estiver ativo. Só crie se precisar forçar outro endereço | — |

**Atenção:** nunca preencha `SITE_URL` com o domínio antes de ele abrir o site. Os links de retorno e o webhook da InfinitePay iriam para um endereço fora do ar.

**Não** crie `SUPABASE_URL` nesta etapa. Para trocar a senha do painel, altere `ADMIN_PASSWORD` e faça um novo deploy. As sessões abertas valem até 12 horas.

### Passo 4 — Domínio galeriavetordigital.com.br
1. No Netlify: **Domain management → Add a domain →** `galeriavetordigital.com.br` (e aceite adicionar o `www`).
2. No Registro.br: **Meus domínios → galeriavetordigital.com.br → DNS → Editar zona** e crie:
   - `A` · nome vazio (ou `@`) · `75.2.60.5`
   - `CNAME` · `www` · `<nome-do-seu-site>.netlify.app` (o nome aparece no painel do Netlify)
3. Espere a propagação (pode levar até 1 dia) e, no Netlify, confirme o certificado HTTPS (é automático).

### Passo 5 — QR Code
Os arquivos em `material-divulgacao/` apontam para `https://galeriavetordigital.com.br/`. **Só imprima depois que o endereço abrir a galeria.** O QR antigo (endereço do GitHub) não deve mais ser usado.

### Passo 6 — Primeiro teste real (exige a sua autorização)
Entre no `/admin`, preencha Configurações (WhatsApp etc.), crie um evento a **R$ 1,00**, envie fotos e compre uma com Pix. É cobrança real, porque a InfinitePay não tem ambiente de teste. Confira se o pedido fica **Pago** e se o original baixa. Depois estorne pelo app da InfinitePay e clique em **Conferir na InfinitePay**: o pedido deve ficar **Estornado**.

### Limites e custos (Netlify)
- Cada requisição ou resposta de função tem limite de 6 MB. Por isso os originais são enviados e baixados **em partes de 4 MB** (o navegador junta), sem limite prático de tamanho.
- As fotos passam pelas funções do Netlify, que têm cache longo na CDN, e isso **consome créditos** do plano. Acompanhe em **Usage**. Com muito volume, será preciso subir de plano ou voltar a um armazenamento dedicado (Supabase ou outro).
- **Backup:** o Netlify Blobs não tem backup automático. Guarde sempre os originais no seu computador ou HD e exporte os pedidos (Pedidos → Exportar CSV) com frequência.
- Painel com **um único login**. A tela Equipe mostra só o dono nesta etapa.

---

A plataforma usa três serviços:

- **Netlify**: hospeda o site e as funções de pagamento.
- **Supabase**: banco de dados, login da equipe e armazenamento das fotos.
- **InfinitePay**: recebe os pagamentos.

As chaves secretas ficam só nas variáveis de ambiente do Netlify. Nunca coloque chaves no código nem as envie por chat.

## 1. Supabase (banco e fotos)

1. Crie uma conta em https://supabase.com e um projeto. Região: **South America (São Paulo)**.
2. Ative as extensões em **Database → Extensions**: `vector` e `pg_cron`.
3. Abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
4. Em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**. Só a equipe acessa o painel.
5. Crie o seu usuário em **Authentication → Users → Add user**, com e-mail e senha.
6. Torne esse usuário o dono do painel. No SQL Editor, rode o comando abaixo trocando o e-mail:

   ```sql
   insert into public.admins (user_id, role)
   select id, 'owner' from auth.users where email = 'SEU-EMAIL@exemplo.com';
   ```

7. Em **Project Settings → API**, anote três valores (eles vão no Netlify, no passo 3):
   - **Project URL**
   - a chave **anon / publishable**, que é pública
   - a chave **service_role / secret**, que é SECRETA

**Planos:** o Free tem 1 GB de armazenamento e 5 GB de tráfego, o suficiente para testar. Uma corrida real (milhares de originais) exige o **Pro**, por cerca de US$ 25 por mês, com 100 GB de armazenamento, 250 GB de tráfego e backup diário.

## 2. InfinitePay

1. Na Conta Web ou no App, abra **Configurações do Checkout** e ligue **Habilitar checkout integrado**.
2. Confira a sua **InfiniteTag** (handle), sem o `$`.
3. Crie uma **API Key** (começa com `inchk_` e aparece uma vez só). Copie e guarde direto no Netlify (passo 3). **Não envie essa chave por chat nem coloque no código.** A chave precisa ser da mesma conta da InfiniteTag, senão a API responde 403.

Com a API Key, cada link:
- aceita **um único pagamento** e expira em **3 dias**;
- respeita a escolha do cliente: em **Cartão**, o Pix fica desligado; em **Pix**, o cartão continua disponível (a InfinitePay não permite desligar o cartão);
- aplica o **desconto no Pix** definido em **Painel → Configurações → Desconto no Pix (%)**.

Sem a API Key, o checkout funciona com a InfiniteTag, mas sem desconto no Pix, sem link único e sem validade.

**Webhook:** não precisa cadastrar nada. Cada link já leva o endereço `/api/infinitepay/webhook` com os eventos `paid`, `refunded`, `canceled` e `payment_failed`. O webhook não tem assinatura, então todo aviso é conferido em `/payment_check` antes de mudar qualquer pedido.

**Estornos:** a API não estorna. Estorne pelo App ou Conta Web da InfinitePay. Se a InfinitePay deixar de confirmar o pagamento, o pedido vira **Estornado** sozinho e os downloads são bloqueados. Se o aviso chegar, mas a InfinitePay ainda confirmar o pagamento, o pedido fica marcado para revisão, e você usa **Marcar como estornado** no painel.

## 3. Netlify

1. Em **Add new project → Import an existing project → GitHub**, escolha este repositório. As configurações de build já estão no `netlify.toml`.
2. Em **Project configuration → Environment variables**, cadastre:

| Variável | Valor | Secreta? |
|---|---|---|
| `SUPABASE_URL` | Project URL do Supabase | não |
| `SUPABASE_ANON_KEY` | chave anon/publishable | não |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role/secret | **SIM** |
| `INFINITEPAY_HANDLE` | sua InfiniteTag, sem `$` | não |
| `INFINITEPAY_API_KEY` | API Key `inchk_...` (recomendada) | **SIM** — marque *Contains secret values* |
| `SITE_URL` | endereço final, ex.: `https://galeria.vetordigital.com.br` | não |

3. Rode um novo deploy em **Deploys → Trigger deploy**.
4. No Supabase, abra **Authentication → URL Configuration** e preencha o **Site URL** com o endereço do site. Isso faz o "Esqueci minha senha" funcionar.

**Créditos do Netlify:** cada deploy em produção custa cerca de 15 créditos, e o plano Free tem 300 por mês. As fotos são servidas pelo Supabase, não pelo Netlify.

## 4. Primeiro teste

1. Acesse `/admin`, entre com o seu usuário e confira os dados em **Configurações** (WhatsApp, Instagram etc.).
2. Crie um evento com preço de **R$ 1,00**, envie algumas fotos e publique a galeria.
3. No site, compre uma foto com **Pix**. O pagamento é real, porque a InfinitePay não tem ambiente de teste (mínimo R$ 1,00). Repita com **Cartão** se quiser testar o parcelamento.
4. Confira estes pontos:
   - O pedido aparece como **Pago** em **Pedidos**.
   - O download do original funciona.
   - O histórico do pedido mostra "confirmado pela InfinitePay".
5. Para devolver o valor do teste, faça o estorno pelo app da InfinitePay. A API não faz estornos.
6. Depois do estorno, abra o pedido no painel e clique em **Conferir na InfinitePay**. Ele deve virar **Estornado** e o download deve parar. Se continuar **Pago**, use **Marcar como estornado**.
7. Em **Pedidos → histórico do pedido**, confira os avisos recebidos (paid, refunded etc.) e o resultado de cada conferência.

## Como funciona a segurança

- **Originais:** ficam em um bucket privado. Só são baixados por links temporários (1 hora) gerados pelo servidor, depois que o pedido está pago.
- **Confirmação de pagamento:** o webhook e o retorno do cliente nunca liberam fotos sozinhos. O servidor sempre confirma na rota oficial `payment_check` da InfinitePay e também confere o valor.
- **Preços:** o servidor lê os preços do banco. O valor enviado pelo navegador é ignorado.
- **Permissões:** são controladas por RLS no banco. Visitantes não leem pedidos, clientes, dados faciais nem o caminho dos originais.
- **Prévias:** a marca-d'água é gravada nos pixels, então a prévia não contém o original.

## Busca pelo rosto e LGPD

- **Selfie:** é processada no celular do atleta. Só um vetor numérico vai para a busca, e ele não é gravado.
- **Fotos do evento:** os vetores faciais são gerados no navegador da equipe, durante o envio, e ficam em uma tabela restrita.
- **Exclusão:** os vetores são apagados automaticamente pelo `pg_cron` no prazo definido em **Configurações** (90 dias por padrão). Também podem ser apagados na hora pelo painel.
- **Atenção:** indexar os rostos de todos os atletas das fotos é tratamento de dado biométrico de pessoas que ainda não deram consentimento. Antes de usar em evento real:
  - Combine com o organizador para incluir essa finalidade no regulamento ou na inscrição da prova.
  - Revise a política de privacidade (página `/#/privacidade`) com um advogado.

## Backup

- **Plano Pro do Supabase:** faz backup diário automático do banco.
- **Pedidos e clientes:** no painel, os botões **Exportar CSV** geram cópias.
- **Originais:** mantenha sempre a sua cópia local das fotos. O armazenamento online não substitui o seu arquivo.

## Testes automáticos

```bash
npm test
```

Os testes rodam os fluxos de pagamento com o Supabase e a InfinitePay simulados.
