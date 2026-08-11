# Segurança e cuidados com dados

## Dados sensíveis

O projeto pode conter endereços, coordenadas, fotos e informações operacionais. Trate os seguintes arquivos como dados internos:

- `data/BASE_ACUMULADA.xlsx`
- `data/REVISITAS_CENSO.xlsx`
- `assets/base.db`
- relatórios de validação

O repositório deve ser privado e ter acesso restrito às pessoas necessárias.

## Credenciais do Google

Nunca versionar ou compartilhar:

- `credentials_oauth.json`
- `token.pickle`

Esses arquivos já estão previstos no `.gitignore`. Caso sejam expostos, revogue as credenciais e gere novas.

## URLs do S3

As URLs precisam ser acessíveis pelo aplicativo. Se forem públicas, qualquer pessoa que obtiver o link poderá acessar a imagem. Se forem assinadas e temporárias, poderão expirar antes da sincronização.

Requisitos operacionais:

- HTTPS.
- Sem dependência de cookies do navegador.
- Tempo de validade compatível com a operação, preferencialmente permanente.
- Controle adequado de acesso ao bucket e aos logs.
- Política de retenção e backup das fotos.

## Google Drive

O Drive distribui apenas o SQLite e o manifesto. Como o SQLite contém dados operacionais e URLs, o compartilhamento da pasta e dos arquivos deve ser revisado periodicamente.

## Git

Antes de commit e push:

```powershell
git status
git diff --check
```

Confirme que nenhum token, credencial, relatório ou arquivo temporário está sendo incluído.

## Backup

Mantenha cópias recuperáveis de:

- Base acumulada.
- Último SQLite válido.
- Manifesto publicado.
- Código-fonte e histórico Git.
- Fotos armazenadas no S3.

Não use a pasta de relatórios temporários como única fonte de recuperação.
