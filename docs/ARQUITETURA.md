# Arquitetura

## Objetivo

O DEEP Mobile permite consultar matrícula, município/setor, endereço, número, coordenadas e foto mesmo em locais com conexão limitada. O SQLite garante a consulta offline; as fotos escolhidas pelo usuário são armazenadas no dispositivo durante a sincronização.

## Componentes

### Excel recebido

Contém os registros novos exportados pela operação. Quando há várias abas, o publicador prioriza a aba `REVISITA`.

Campos consumidos pelo aplicativo:

| Campo do app | Origem esperada no Excel |
|---|---|
| `matricula` | `codigo_unico` ou equivalente |
| `bairro` | `1.4 Município_field`, normalizado com setor |
| `endereco` | `1.6 Logradouro_field` |
| `numero` | `1.7.1 Número_field` |
| `foto` | URL original da foto no S3 |
| `latitude` | `Latitude` |
| `longitude` | `Longitude` |

### Publicador DEEP

O publicador:

1. Lê o Excel recebido.
2. Compara as linhas com a base acumulada.
3. Ignora linhas idênticas já importadas.
4. Mantém matrículas repetidas, pois podem representar revisitas.
5. Normaliza município/setor e número do imóvel.
6. Valida campos, coordenadas e URLs.
7. Gera a tabela `casas` no SQLite.
8. Cria índices para `matricula` e `bairro`.
9. Executa `PRAGMA integrity_check`.
10. Publica `base.db` e `versao.json` no Google Drive.
11. Atualiza `BASE_ACUMULADA.xlsx` após publicação bem-sucedida.

### Controle de setores

O arquivo `data/controle_setores.json` registra setores ativos/finalizados e o histórico de alterações. A base acumulada continua contendo todos os registros. Durante a criação do SQLite, o publicador retira apenas os registros pertencentes a setores finalizados.

Cada alteração registra:

- setor;
- status (`ativo` ou `finalizado`);
- data e hora;
- responsável;
- observação.

Uma reativação volta a incluir o setor na próxima republicação.

### Google Drive

Armazena apenas:

- `base.db`: banco completo para o aplicativo.
- `versao.json`: versão, data, quantidade de registros/fotos, tamanho e hashes do banco.

As fotos não são armazenadas no Drive.

### S3

O SQLite mantém a URL original de cada foto. O aplicativo usa essa URL para exibição online e download offline. Os links precisam ser HTTPS, acessíveis pelo celular e permanentes; links expirados ou removidos deixam a foto indisponível.

### Aplicativo

Ao iniciar, o aplicativo:

1. Verifica atualizações EAS sem bloquear a tela.
2. Consulta a versão remota do banco.
3. Baixa um banco novo para `base.nova.db` quando necessário.
4. Confere tamanho, MD5, integridade e presença da tabela `casas`.
5. Mantém o banco anterior como backup durante a troca.
6. Restaura o backup se o banco novo falhar.

Na sincronização de fotos, o app consulta as URLs do setor selecionado e baixa os arquivos em lotes para a pasta local `fotos`.

## SQLite

Tabela principal:

```sql
CREATE TABLE casas (
  matricula,
  bairro,
  endereco,
  numero,
  foto,
  latitude,
  longitude
);
```

Índices:

```sql
CREATE INDEX idx_casas_matricula ON casas(matricula);
CREATE INDEX idx_casas_bairro ON casas(bairro COLLATE NOCASE);
```

## Dados offline

- O banco completo fica disponível offline.
- As fotos ficam offline somente depois da sincronização do município/setor.
- Uma busca sem foto local pode exibir a URL remota quando houver internet.
- O mapa offline é responsabilidade do aplicativo de mapas instalado no celular.
