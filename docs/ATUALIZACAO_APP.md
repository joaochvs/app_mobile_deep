# Atualizações do aplicativo

Existem duas atualizações diferentes no projeto: atualização dos dados e atualização do código do aplicativo.

## Atualização dos dados

É feita pelo Publicador DEEP e não exige EAS Update nem nova build.

Exemplos:

- Adicionar registros.
- Corrigir endereço, setor ou número.
- Alterar URLs de fotos.
- Republicar o SQLite.

O celular detecta a nova versão de `versao.json` e baixa `base.db`.

## EAS Update

Use EAS Update quando houver mudança somente em JavaScript/TypeScript ou em assets compatíveis com o runtime já instalado.

Testar primeiro no canal preview:

```powershell
eas update --channel preview --message "Descrição da mudança" --environment preview
```

Depois de validar, publicar em produção:

```powershell
eas update --channel production --message "Descrição da mudança" --environment production
```

O projeto possui os canais `development`, `preview` e `production` configurados em `eas.json`.

## Quando gerar nova build

Gere uma nova build quando houver:

- Instalação ou atualização de biblioteca com código nativo.
- Alteração de plugins nativos do Expo.
- Mudança de permissões Android/iOS.
- Atualização do Expo SDK ou React Native.
- Alteração incompatível do runtime nativo.

Build Android de preview:

```powershell
eas build --platform android --profile preview
```

Build Android de produção:

```powershell
eas build --platform android --profile production
```

## Teste após EAS Update

1. Feche completamente o app.
2. Abra com internet e aguarde alguns segundos.
3. O app pode reiniciar ao aplicar o update.
4. Feche e abra novamente se necessário.
5. Pesquise uma matrícula antiga.
6. Pesquise uma matrícula recente.
7. Sincronize um setor.
8. Ative o modo avião.
9. Repita as buscas e confirme as fotos offline.

O menu de diagnóstico pode ser aberto tocando cinco vezes rapidamente no logo.

## Regra prática

| Mudança | Publicar dados | EAS Update | Nova build |
|---|---:|---:|---:|
| Novo Excel | Sim | Não | Não |
| Correção do SQLite | Sim | Não | Não |
| Alteração de tela/regra TypeScript | Não | Sim | Não |
| Comentários ou documentação | Não | Não | Não |
| Nova biblioteca nativa | Não | Não | Sim |
