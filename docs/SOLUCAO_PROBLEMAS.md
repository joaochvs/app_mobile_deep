# Solução de problemas

## O publicador encontrou centenas de registros em um teste pequeno

Confirme a linha `Aba utilizada`. O publicador prioriza `REVISITA`; outras abas do Excel podem conter centenas de registros ocultos.

## A planilha está bloqueada

Feche o arquivo no Excel e tente novamente. O OneDrive ou Excel pode impedir a leitura enquanto uma sincronização está ocorrendo.

## Nenhum registro novo para publicar

As linhas selecionadas já existem na base acumulada. Use outro Excel ou, se precisar apenas regenerar o banco, clique em **Republicar base com links S3**.

## Muitos avisos no total acumulado

O publicador separa:

- avisos nos registros novos;
- avisos históricos da base acumulada.

Priorize os avisos dos registros novos. Matrículas repetidas podem ser revisitas legítimas.

## Foto não aparece

Verifique:

1. Se a coluna `foto` contém uma URL HTTPS.
2. Se o link abre no navegador sem login.
3. Se o S3 retorna a imagem e não um erro 403/404.
4. Se há internet para a primeira exibição.
5. Se o município/setor foi sincronizado para uso offline.

Links removidos ou expirados no S3 não podem ser baixados pelo app.

## O app não recebeu o banco novo

1. Confirme que o publicador terminou com sucesso.
2. Confira se `versao.json` foi incrementado.
3. Abra o app com internet.
4. Puxe a tela para baixo.
5. Aguarde a mensagem de atualização.
6. Abra o diagnóstico tocando cinco vezes no logo.

## O app não recebeu o EAS Update

1. Confirme o canal usado na publicação.
2. Verifique se a build instalada aponta para o mesmo canal.
3. Confirme que o runtime é compatível.
4. Feche e abra o app novamente.
5. Teste primeiro em preview antes de produção.

## Sem internet durante atualização do banco

O app mantém o banco anterior. O banco novo é baixado separadamente, validado e somente depois ativado. Se a troca falhar, o backup anterior é restaurado.

## Erro de autenticação do Google Drive

- Confirme a presença de `credentials_oauth.json`.
- Exclua `token.pickle` apenas quando for necessário refazer o login.
- Execute novamente o publicador e conclua a autenticação no navegador.
- Nunca envie esses arquivos para outra pessoa ou para o Git.

## O Publicador DEEP não abre

No PowerShell, execute:

```powershell
python -m pip install -r requirements-publicador.txt
python publicador_deep.py
```

O erro exibido no terminal normalmente identifica a dependência ausente.
