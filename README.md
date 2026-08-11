# DEEP Mobile

Aplicativo mobile para consulta de propriedades e fotos em campo, com suporte a funcionamento offline. Os dados ficam em SQLite no celular e as fotos são baixadas diretamente do S3 durante a sincronização por município/setor.

## Fluxo atual

```text
Excel recebido (registros novos)
             ↓
      Publicador DEEP
             ↓
Validação + base acumulada + SQLite
             ↓
 Google Drive: base.db + versao.json
             ↓
 Aplicativo atualiza o SQLite
             ↓
 Aplicativo baixa fotos diretamente do S3
```

As fotos não são copiadas para o Google Drive. O Drive armazena somente o banco `base.db` e o manifesto `versao.json`.

## Tecnologias

- Expo SDK 56 e React Native.
- TypeScript e Expo Router.
- SQLite para consultas offline.
- Python, pandas e Tkinter no Publicador DEEP.
- Google Drive para distribuição do banco e do manifesto.
- S3 da DEEPESSOAS para as fotos.
- EAS Update para atualizações de JavaScript/TypeScript.

## Uso rápido do publicador

1. Execute `Abrir Publicador DEEP.bat`.
2. Clique em **Escolher Excel** e selecione o arquivo recebido.
3. Clique em **1. Validar somente**.
4. Confira a aba utilizada, registros novos e avisos.
5. Clique em **2. Adicionar e publicar**.
6. Confirme a operação e aguarde a mensagem de sucesso.

O publicador prioriza automaticamente a aba `REVISITA`, mantém a base anterior e adiciona somente linhas novas.

A navegação lateral reúne três áreas: **Publicação**, com indicadores e ações do fluxo; **Setores**, para pesquisar, finalizar ou reativar setores; e **Histórico**, com o registro das alterações de status.

## Desenvolvimento do aplicativo

```powershell
npm install
npx expo start
```

Outros comandos:

```powershell
npm run android
npm run web
npm run lint
```

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Publicação de dados](docs/PUBLICACAO_DADOS.md)
- [Atualizações do aplicativo](docs/ATUALIZACAO_APP.md)
- [Solução de problemas](docs/SOLUCAO_PROBLEMAS.md)
- [Segurança e cuidados com dados](docs/SEGURANCA.md)

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `src/app/index.tsx` | Tela, consulta, atualização do banco e sincronização offline |
| `src/utils/initDatabase.native.ts` | Inicialização do SQLite no dispositivo |
| `subir_google_drive.py` | Validação, geração e publicação dos dados |
| `publicador_deep.py` | Interface gráfica do publicador |
| `data/BASE_ACUMULADA.xlsx` | Fonte acumulada usada nas publicações |
| `data/controle_setores.json` | Status e histórico dos setores ativos/finalizados |
| `assets/base.db` | Banco SQLite gerado e banco inicial do app |
| `data/versao.json` | Manifesto da versão publicada |
| `eas.json` | Perfis e canais de build/update |

## Regra importante

Use **Validar somente** antes de cada publicação. Não edite manualmente `base.db` ou `versao.json`; eles são gerados pelo publicador.
