# Publicação de dados

## Preparação inicial do computador

Instale Python e as dependências do publicador:

```powershell
python -m pip install -r requirements-publicador.txt
```

Os arquivos `credentials_oauth.json` e `token.pickle` devem permanecer apenas no computador autorizado e nunca devem ser enviados ao Git.

## Publicação incremental

Use este processo quando receber um Excel contendo somente registros novos.

1. Feche o Excel para evitar bloqueio do arquivo.
2. Abra `Abrir Publicador DEEP.bat`.
3. Clique em **Escolher Excel**.
4. Selecione o Excel recebido.
5. Clique em **1. Validar somente**.
6. Confirme no log:
   - `Aba utilizada: REVISITA` quando essa aba existir;
   - quantidade da base atual;
   - quantidade de registros novos;
   - quantidade de registros já importados;
   - avisos nos registros novos.
7. Resolva erros nos registros novos antes de publicar.
8. Clique em **2. Adicionar e publicar**.
9. Confirme e aguarde `FINALIZADO`.

O botão incremental não remove registros anteriores. Linhas exatamente iguais às já existentes são ignoradas.

## Áreas da interface

- **Publicação:** mostra versão, registros, links de fotos e setores finalizados, além das ações de validar, adicionar e republicar.
- **Setores:** permite pesquisar e filtrar setores, consultar quantidades e finalizar ou reativar o item selecionado.
- **Histórico:** apresenta quem alterou cada setor, quando a alteração ocorreu e a observação registrada.

## Republicar a base atual

Use **Republicar base com links S3** quando for necessário regenerar todo o SQLite sem adicionar um novo Excel, por exemplo:

- Aplicar uma nova regra de limpeza aos registros existentes.
- Corrigir formatação do número dos imóveis.
- Migrar novamente todos os links para S3.
- Recriar índices ou manifesto.

Esse botão usa `data/BASE_ACUMULADA.xlsx` e não altera as fotos no S3 ou no Drive.

## Finalizar ou reativar um setor

1. Abra o Publicador DEEP.
2. Na navegação lateral, clique em **Setores**.
3. Consulte o status e a quantidade de registros.
4. Selecione um setor.
5. Clique em **Finalizar setor** ou **Reativar setor**.
6. Confirme a quantidade apresentada.
7. Informe o responsável e, opcionalmente, uma observação.
8. Volte para **Publicação**.
9. Clique em **Republicar base** para aplicar a mudança nos celulares.

Finalizar não apaga registros da `BASE_ACUMULADA.xlsx`. O setor fica fora apenas do SQLite publicado. Reativar desfaz essa exclusão na próxima publicação.

Se um Excel novo contiver registros de setor finalizado, esses registros serão preservados no histórico, mas não entrarão no banco enquanto o setor continuar finalizado.

## Regras automáticas

### Município e setor

O setor é extraído do final do campo `endereco`. São aceitos formatos como:

```text
STOR 7
STOR 07
SETOR 7
SETOR_002
```

Resultado:

```text
EMBU DAS ARTES - SETOR 7
```

O nome original do município é preservado; somente o setor é normalizado.

### Número do imóvel

- `1493.0` torna-se `1493`.
- `280.0` torna-se `280`.
- `S/N` permanece `S/N`.
- Um decimal real, como `12.5`, é preservado.

### Fotos

- A primeira URL válida da célula é usada.
- A URL do S3 é gravada diretamente no banco.
- Nenhuma foto é baixada pelo publicador.
- Nenhuma foto é enviada ao Google Drive.

## Arquivos produzidos

- `assets/base.db`
- `data/versao.json`
- `data/BASE_ACUMULADA.xlsx`
- `data/controle_setores.json`
- `relatorios/validacao_AAAAMMDD_HHMMSS.json`
- `relatorios/validacao_AAAAMMDD_HHMMSS.csv`

Os relatórios ficam locais e são ignorados pelo Git.

## Manifesto

Exemplo de `versao.json`:

```json
{
  "versao": 62,
  "publicadoEm": "2026-08-10T22:06:42-03:00",
  "totalRegistros": 4889,
  "totalFotos": 4682,
  "tamanhoBanco": 1540096,
  "hashBanco": "sha256...",
  "md5Banco": "md5..."
}
```

A versão só é incrementada após a geração e validação do banco.

## Linha de comando

Validar um Excel incremental sem publicar:

```powershell
python subir_google_drive.py "C:\caminho\arquivo.xlsx" --incremental --validar-apenas
```

Adicionar e publicar:

```powershell
python subir_google_drive.py "C:\caminho\arquivo.xlsx" --incremental
```

Republicar a base acumulada:

```powershell
python subir_google_drive.py "data\BASE_ACUMULADA.xlsx"
```
