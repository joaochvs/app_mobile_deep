import argparse
import hashlib
import json
import os
import pickle
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import pandas as pd
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload


# Mantém os símbolos do relatório legíveis também no terminal do Windows.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


PASTA_DRIVE_ID = "1EdRItu4bu-dsbn_lIIxSqbATihyvmzmb"
PASTA_PROJETO = Path(__file__).resolve().parent
ARQUIVO_EXCEL_PADRAO = PASTA_PROJETO / "data" / "REVISITAS_CENSO.xlsx"
BASE_ACUMULADA = PASTA_PROJETO / "data" / "BASE_ACUMULADA.xlsx"
BANCO_LOCAL = PASTA_PROJETO / "assets" / "base.db"
VERSAO_LOCAL = PASTA_PROJETO / "data" / "versao.json"
PASTA_RELATORIOS = PASTA_PROJETO / "relatorios"
COLUNA_CONTROLE_NOVO = "__registro_novo__"

# Cada campo aceita mais de um cabeçalho. A comparação ignora acentos,
# maiúsculas/minúsculas e espaços duplicados.
COLUNAS = {
    "matricula": ["codigo_unico", "código único", "codigo unico", "1.1.1 Matrícula_field"],
    "bairro": ["1.4 Município_field", "1.5 Bairro_field", "bairro", "município", "municipio"],
    "endereco_setor": ["endereco"],
    "endereco": ["1.6 Logradouro_field", "logradouro", "endereço", "endereco", "rua"],
    "numero": ["1.7.1 Número_field", "número", "numero"],
    "foto": [
        "1.9.1 Tire uma foto da visita da propriedade (horizontal)_field",
        "foto", "foto_url", "url_foto",
    ],
    "latitude": ["Latitude", "latitude"],
    "longitude": ["Longitude", "longitude"],
}

CAMPOS_OBRIGATORIOS = {"matricula", "bairro", "endereco"}


def normalizar_nome(valor):
    texto = unicodedata.normalize("NFKD", str(valor))
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", texto).strip().casefold()


def texto_limpo(valor):
    if pd.isna(valor):
        return None
    texto = str(valor).strip()
    return texto or None


def matricula_limpa(valor):
    if pd.isna(valor):
        return None
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    texto = str(valor).strip()
    return texto or None


def numero_limpo(valor):
    if pd.isna(valor):
        return None
    if isinstance(valor, (int, float)) and float(valor).is_integer():
        return str(int(valor))
    texto = str(valor).strip()
    # O Excel frequentemente transforma números de imóvel inteiros em 1493.0.
    encontrado = re.fullmatch(r"([+-]?\d+)\.0+", texto)
    if encontrado:
        return encontrado.group(1)
    return texto or None


def limpar_foto_url(valor):
    if not isinstance(valor, str):
        return None
    primeira = valor.replace("\r\n", "\n").split("\n")[0].split()[0].strip()
    return primeira if primeira.startswith(("http://", "https://")) else None


def aplicar_setor_ao_municipio(municipio, endereco_setor):
    """Converte, por exemplo, STOR 07/SETOR_007 em MUNICÍPIO - SETOR 7."""
    municipio = texto_limpo(municipio)
    endereco_setor = texto_limpo(endereco_setor)
    if not municipio or not endereco_setor:
        return municipio, None
    encontrado = re.search(r"(?:STOR|SETOR)\s*[-_:]?\s*0*(\d+)\s*$", endereco_setor, re.IGNORECASE)
    if not encontrado:
        return municipio, None
    setor = int(encontrado.group(1))
    municipio_base = re.sub(
        r"\s*-\s*(?:STOR|SETOR)\s*[-_:]?\s*0*\d+\s*$", "", municipio, flags=re.IGNORECASE
    ).strip()
    return f"{municipio_base} - SETOR {setor}", setor


def hash_linhas(df):
    normalizado = df.astype("string").fillna("").apply(lambda coluna: coluna.str.strip())
    return pd.util.hash_pandas_object(normalizado, index=False)


def ler_excel_recebido(caminho_excel):
    """Prioriza a aba REVISITA quando o arquivo recebido possui várias abas."""
    arquivo = pd.ExcelFile(caminho_excel)
    por_nome_normalizado = {normalizar_nome(aba): aba for aba in arquivo.sheet_names}
    aba = por_nome_normalizado.get("revisita", arquivo.sheet_names[0])
    return pd.read_excel(arquivo, sheet_name=aba), aba


def preparar_base(caminho_excel, incremental):
    if not caminho_excel.exists():
        raise FileNotFoundError(f"Excel não encontrado: {caminho_excel}")
    recebida, aba_recebida = ler_excel_recebido(caminho_excel)
    if not incremental:
        recebida = pd.concat([
            recebida,
            pd.Series(True, index=recebida.index, name=COLUNA_CONTROLE_NOVO),
        ], axis=1)
        return recebida, None, {
            "modo": "base completa", "registrosRecebidos": len(recebida),
            "registrosNovos": len(recebida), "registrosRepetidosIgnorados": 0,
            "abaRecebida": aba_recebida,
        }

    origem_base = BASE_ACUMULADA if BASE_ACUMULADA.exists() else ARQUIVO_EXCEL_PADRAO
    if caminho_excel.resolve() == origem_base.resolve():
        raise ValueError("No modo incremental, selecione o Excel NOVO recebido, não a base acumulada.")
    base = pd.read_excel(origem_base)
    colunas = list(base.columns) + [coluna for coluna in recebida.columns if coluna not in base.columns]
    base = base.reindex(columns=colunas)
    recebida = recebida.reindex(columns=colunas)

    hashes_base = set(hash_linhas(base).tolist())
    hashes_recebida = hash_linhas(recebida)
    repetida = hashes_recebida.isin(hashes_base) | hashes_recebida.duplicated(keep="first")
    novas = recebida.loc[~repetida].copy()
    base = pd.concat([
        base,
        pd.Series(False, index=base.index, name=COLUNA_CONTROLE_NOVO),
    ], axis=1)
    novas = pd.concat([
        novas,
        pd.Series(True, index=novas.index, name=COLUNA_CONTROLE_NOVO),
    ], axis=1)
    combinada = pd.concat([base, novas], ignore_index=True)
    return combinada, novas, {
        "modo": "incremental",
        "abaRecebida": aba_recebida,
        "baseUtilizada": str(origem_base),
        "registrosAnteriores": len(base),
        "registrosRecebidos": len(recebida),
        "registrosNovos": len(novas),
        "registrosRepetidosIgnorados": int(repetida.sum()),
        "totalAposImportacao": len(combinada),
    }


def localizar_colunas(df):
    disponiveis = {}
    for coluna in df.columns:
        disponiveis.setdefault(normalizar_nome(coluna), coluna)

    encontradas = {}
    for destino, alternativas in COLUNAS.items():
        for alternativa in alternativas:
            original = disponiveis.get(normalizar_nome(alternativa))
            if original is not None:
                encontradas[destino] = original
                break
    return encontradas


def validar_excel(caminho_excel, df=None):
    if df is None:
        if not caminho_excel.exists():
            raise FileNotFoundError(f"Excel não encontrado: {caminho_excel}")
        df = pd.read_excel(caminho_excel)
    colunas = localizar_colunas(df)
    ausentes = sorted(CAMPOS_OBRIGATORIOS - set(colunas))
    if ausentes:
        nomes = ", ".join(ausentes)
        raise ValueError(f"Colunas obrigatórias não encontradas: {nomes}")

    avisos = []
    registros = []
    for indice, row in df.iterrows():
        linha_excel = indice + 2
        get = lambda campo: row.get(colunas[campo]) if campo in colunas else None

        matricula = matricula_limpa(get("matricula"))
        bairro_original = texto_limpo(get("bairro"))
        bairro, setor = aplicar_setor_ao_municipio(bairro_original, get("endereco_setor"))
        endereco = texto_limpo(get("endereco"))
        numero = numero_limpo(get("numero"))
        foto_bruta = get("foto")
        foto = limpar_foto_url(foto_bruta)
        latitude = pd.to_numeric(get("latitude"), errors="coerce")
        longitude = pd.to_numeric(get("longitude"), errors="coerce")

        problemas = []
        if not matricula:
            problemas.append("matrícula vazia; registro ignorado")
        if not bairro:
            problemas.append("bairro vazio")
        if texto_limpo(get("endereco_setor")) and setor is None:
            problemas.append("setor não identificado no campo endereco")
        if not endereco:
            problemas.append("endereço vazio")
        if texto_limpo(foto_bruta) and not foto:
            problemas.append("URL da foto inválida")
        if pd.notna(latitude) and not -90 <= float(latitude) <= 90:
            problemas.append("latitude fora do intervalo; valor removido")
            latitude = None
        if pd.notna(longitude) and not -180 <= float(longitude) <= 180:
            problemas.append("longitude fora do intervalo; valor removido")
            longitude = None
        if pd.isna(latitude):
            latitude = None
        if pd.isna(longitude):
            longitude = None

        for problema in problemas:
            avisos.append({"linha": linha_excel, "matricula": matricula, "problema": problema})

        if not matricula:
            continue

        registros.append({
            "matricula": matricula,
            "bairro": bairro,
            "endereco": endereco,
            "numero": numero,
            "foto_origem": foto,
            "latitude": latitude,
            "longitude": longitude,
            "_novo": bool(row.get(COLUNA_CONTROLE_NOVO, False)),
        })

    dados = pd.DataFrame(registros)
    if dados.empty:
        raise ValueError("Nenhum registro válido foi encontrado no Excel.")

    duplicadas = dados["matricula"].duplicated(keep=False)
    for _, registro in dados[duplicadas].iterrows():
        avisos.append({
            "linha": None,
            "matricula": registro["matricula"],
            "problema": "matrícula duplicada; ordem original preservada",
        })

    resumo = {
        "arquivo": str(caminho_excel),
        "geradoEm": datetime.now().astimezone().isoformat(timespec="seconds"),
        "linhasLidas": int(len(df)),
        "registrosValidos": int(len(dados)),
        "registrosIgnorados": int(len(df) - len(dados)),
        "matriculasDuplicadas": int(duplicadas.sum()),
        "registrosSemFoto": int(dados["foto_origem"].isna().sum()),
        "registrosComSetorAutomatico": int(sum(
            aplicar_setor_ao_municipio(
                row.get(colunas["bairro"]),
                row.get(colunas["endereco_setor"]) if "endereco_setor" in colunas else None,
            )[1] is not None
            for _, row in df.iterrows()
        )),
        "avisos": int(len(avisos)),
        "colunasUtilizadas": {campo: str(original) for campo, original in colunas.items()},
    }
    return dados, avisos, resumo


def salvar_relatorio(avisos, resumo):
    PASTA_RELATORIOS.mkdir(parents=True, exist_ok=True)
    identificador = datetime.now().strftime("%Y%m%d_%H%M%S")
    caminho_json = PASTA_RELATORIOS / f"validacao_{identificador}.json"
    caminho_csv = PASTA_RELATORIOS / f"validacao_{identificador}.csv"
    caminho_json.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    pd.DataFrame(avisos, columns=["linha", "matricula", "problema"]).to_csv(
        caminho_csv, index=False, encoding="utf-8-sig"
    )
    return caminho_json, caminho_csv


def get_drive_service():
    scopes = ["https://www.googleapis.com/auth/drive"]
    token_path = PASTA_PROJETO / "token.pickle"
    credenciais_path = PASTA_PROJETO / "credentials_oauth.json"
    creds = None
    if token_path.exists():
        with token_path.open("rb") as token:
            creds = pickle.load(token)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(credenciais_path), scopes)
            creds = flow.run_local_server(port=0)
        with token_path.open("wb") as token:
            pickle.dump(creds, token)
    return build("drive", "v3", credentials=creds)


def upload_arquivo_local(service, caminho_local, nome_no_drive, pasta_id, mimetype="application/octet-stream"):
    resultado = service.files().list(
        q=f"name='{nome_no_drive}' and '{pasta_id}' in parents and trashed=false",
        fields="files(id)",
    ).execute()
    media = MediaFileUpload(str(caminho_local), mimetype=mimetype)
    if resultado["files"]:
        file_id = resultado["files"][0]["id"]
        service.files().update(fileId=file_id, media_body=media).execute()
        print(f"🔄 Atualizado: {nome_no_drive}")
        return file_id
    arquivo = service.files().create(
        body={"name": nome_no_drive, "parents": [pasta_id]}, media_body=media, fields="id"
    ).execute()
    print(f"⬆️ Enviado: {nome_no_drive}")
    return arquivo.get("id")


def get_versao_atual(service, pasta_id):
    resultado = service.files().list(
        q=f"name='versao.json' and '{pasta_id}' in parents and trashed=false", fields="files(id)"
    ).execute()
    if not resultado["files"]:
        return 0
    conteudo = service.files().get_media(fileId=resultado["files"][0]["id"]).execute()
    return json.loads(conteudo).get("versao", 0)


def publicar(dados, resumo):
    print("\n☁️ Conectando ao Drive...")
    service = get_drive_service()

    registros = []
    for indice, row in dados.iterrows():
        registros.append({
            "matricula": row["matricula"], "bairro": row["bairro"],
            "endereco": row["endereco"], "numero": row["numero"],
            "foto": row["foto_origem"], "latitude": row["latitude"], "longitude": row["longitude"],
        })
        if (indice + 1) % 250 == 0:
            print(f"  🔗 {indice + 1}/{len(dados)} links processados")

    BANCO_LOCAL.parent.mkdir(parents=True, exist_ok=True)
    df_final = pd.DataFrame(registros)
    with sqlite3.connect(BANCO_LOCAL) as conn:
        df_final.to_sql("casas", conn, if_exists="replace", index=False)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_casas_matricula ON casas(matricula)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_casas_bairro ON casas(bairro COLLATE NOCASE)")
        total_banco = conn.execute("SELECT COUNT(*) FROM casas").fetchone()[0]
        if total_banco != len(df_final):
            raise RuntimeError(
                f"O SQLite recebeu {total_banco} registros; eram esperados {len(df_final)}."
            )
        resultado = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if resultado != "ok":
            raise RuntimeError(f"Falha na integridade do SQLite: {resultado}")

    hash_banco = hashlib.sha256(BANCO_LOCAL.read_bytes()).hexdigest()
    md5_banco = hashlib.md5(BANCO_LOCAL.read_bytes()).hexdigest()
    upload_arquivo_local(service, BANCO_LOCAL, "base.db", PASTA_DRIVE_ID)
    nova_versao = get_versao_atual(service, PASTA_DRIVE_ID) + 1
    manifesto = {
        "versao": nova_versao,
        "publicadoEm": datetime.now().astimezone().isoformat(timespec="seconds"),
        "totalRegistros": len(df_final),
        "totalFotos": int(df_final["foto"].notna().sum()),
        "tamanhoBanco": BANCO_LOCAL.stat().st_size,
        "hashBanco": hash_banco,
        "md5Banco": md5_banco,
    }
    VERSAO_LOCAL.write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding="utf-8")
    upload_arquivo_local(service, VERSAO_LOCAL, "versao.json", PASTA_DRIVE_ID, "application/json")
    resumo.update({
        "versaoPublicada": nova_versao,
        "linksFotosS3": int(df_final["foto"].notna().sum()),
    })
    print(f"\n✅ FINALIZADO — versão {nova_versao} publicada com {len(df_final)} registros!")


def argumentos_cli():
    parser = argparse.ArgumentParser(description="Valida o Excel e publica o banco offline do app DEEP.")
    parser.add_argument("arquivo", nargs="?", type=Path, default=ARQUIVO_EXCEL_PADRAO,
                        help="Excel recebido (padrão: data/REVISITAS_CENSO.xlsx)")
    parser.add_argument("--validar-apenas", action="store_true",
                        help="Gera o relatório sem conectar ou alterar o Google Drive")
    parser.add_argument("--incremental", action="store_true",
                        help="Adiciona o Excel recebido à base acumulada sem remover registros antigos")
    return parser.parse_args()


def main():
    args = argumentos_cli()
    caminho = args.arquivo.expanduser().resolve()
    print(f"📊 Preparando Excel: {caminho}")
    df_combinado, novos, resumo_importacao = preparar_base(caminho, args.incremental)
    print(f"📄 Aba utilizada: {resumo_importacao['abaRecebida']}")
    if args.incremental:
        print(f"📦 Base atual: {resumo_importacao['registrosAnteriores']} registros")
        print(f"➕ Novos: {resumo_importacao['registrosNovos']} registros")
        print(f"⏩ Já importados: {resumo_importacao['registrosRepetidosIgnorados']} registros")
        if resumo_importacao["registrosNovos"] == 0 and not args.validar_apenas:
            raise ValueError("Nenhum registro novo para publicar.")
    dados, avisos, resumo = validar_excel(caminho, df_combinado)
    resumo.update(resumo_importacao)
    if args.incremental and novos is not None and not novos.empty:
        _, avisos_novos, _ = validar_excel(caminho, novos)
        resumo["avisosNovos"] = len(avisos_novos)
    else:
        resumo["avisosNovos"] = resumo["avisos"]
    relatorio_json, relatorio_csv = salvar_relatorio(avisos, resumo)
    print(f"✅ {resumo['registrosValidos']} registros válidos")
    if args.incremental:
        print(f"⚠️ {resumo['avisosNovos']} avisos nos registros novos")
        print(f"🗃️ {resumo['avisos']} avisos no total acumulado")
    else:
        print(f"⚠️ {resumo['avisos']} avisos")
    print(f"📄 Relatórios: {relatorio_json.name} e {relatorio_csv.name}")
    if args.validar_apenas:
        print("🛡️ Validação concluída. Nada foi alterado no Drive.")
        return
    publicar(dados, resumo)
    if args.incremental:
        caminho_temporario = BASE_ACUMULADA.with_suffix(".nova.xlsx")
        df_combinado.drop(columns=[COLUNA_CONTROLE_NOVO], errors="ignore").to_excel(
            caminho_temporario, index=False
        )
        os.replace(caminho_temporario, BASE_ACUMULADA)
        print(f"💾 Base acumulada salva com {len(df_combinado)} registros.")
    relatorio_json.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as erro:
        print(f"\n❌ {erro}", file=sys.stderr)
        raise SystemExit(1)
