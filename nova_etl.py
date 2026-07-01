#%%
import pandas as pd
import sqlite3
import json
import os
import requests
import pickle
from io import BytesIO
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

# ─── CONFIGURAÇÃO ───────────────────────────────────────
PASTA_DRIVE_ID = "1EdRItu4bu-dsbn_lIIxSqbATihyvmzmb"
ARQUIVO_EXCEL  = r"data\REVISITAS_CENSO.xlsx"
CACHE_IDS      = "data/cache_ids.json"
# ────────────────────────────────────────────────────────

def get_drive_service():
    SCOPES = ["https://www.googleapis.com/auth/drive"]
    creds = None
    if os.path.exists("token.pickle"):
        with open("token.pickle", "rb") as token:
            creds = pickle.load(token)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                "credentials_oauth.json", SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open("token.pickle", "wb") as token:
            pickle.dump(creds, token)
    return build("drive", "v3", credentials=creds)


def upload_arquivo_local(service, caminho_local, nome_no_drive, pasta_id, mimetype="application/octet-stream"):
    resultado = service.files().list(
        q=f"name='{nome_no_drive}' and '{pasta_id}' in parents and trashed=false",
        fields="files(id)"
    ).execute()
    media = MediaFileUpload(caminho_local, mimetype=mimetype)
    if resultado["files"]:
        file_id = resultado["files"][0]["id"]
        service.files().update(fileId=file_id, media_body=media).execute()
        print(f"🔄 Atualizado: {nome_no_drive}")
        return file_id
    else:
        file = service.files().create(
            body={"name": nome_no_drive, "parents": [pasta_id]},
            media_body=media, fields="id"
        ).execute()
        print(f"⬆️ Enviado: {nome_no_drive}")
        return file.get("id")


def get_versao_atual(service, pasta_id):
    resultado = service.files().list(
        q=f"name='versao.json' and '{pasta_id}' in parents and trashed=false",
        fields="files(id)"
    ).execute()
    if resultado["files"]:
        file_id = resultado["files"][0]["id"]
        content = service.files().get_media(fileId=file_id).execute()
        return json.loads(content).get("versao", 0)
    return 0


# ─── INÍCIO ─────────────────────────────────────────────
print("☁️  Conectando ao Drive...")
service = get_drive_service()

# ─── PASTA DE FOTOS NO DRIVE ────────────────────────────
resultado_pasta = service.files().list(
    q=f"name='fotos' and '{PASTA_DRIVE_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields="files(id)"
).execute()

if resultado_pasta["files"]:
    pasta_fotos_id = resultado_pasta["files"][0]["id"]
else:
    pasta = service.files().create(
        body={"name": "fotos", "mimeType": "application/vnd.google-apps.folder", "parents": [PASTA_DRIVE_ID]},
        fields="id"
    ).execute()
    pasta_fotos_id = pasta["id"]

# ─── CARREGA CACHE LOCAL ────────────────────────────────
print("\n🔍 Lendo fotos diretamente do Drive...")

cache_ids = {}  # 🔥 zera e recria

page_token = None
while True:
    params = {
        "q": f"'{pasta_fotos_id}' in parents and trashed=false and mimeType='image/jpeg'",
        "fields": "nextPageToken, files(id, name)",
        "pageSize": 1000,
    }

    if page_token:
        params["pageToken"] = page_token

    resultado = service.files().list(**params).execute()

    for f in resultado.get("files", []):
        cache_ids[f["name"]] = f["id"]

    page_token = resultado.get("nextPageToken")
    if not page_token:
        break

print(f"✅ Cache reconstruído com {len(cache_ids)} fotos do Drive")

# ─── SINCRONIZA CACHE COM O DRIVE ───────────────────────
# garante que fotos já no Drive entram no cache (evita duplicatas)
print("\n🔍 Sincronizando cache com o Drive...")
page_token = None
fotos_no_drive = 0
while True:
    params = {
        "q": f"'{pasta_fotos_id}' in parents and trashed=false and mimeType='image/jpeg'",
        "fields": "nextPageToken, files(id, name)",
        "pageSize": 1000,
    }
    if page_token:
        params["pageToken"] = page_token
    resultado = service.files().list(**params).execute()
    for f in resultado.get("files", []):
        if f["name"] not in cache_ids:
            cache_ids[f["name"]] = f["id"]
            fotos_no_drive += 1
    page_token = resultado.get("nextPageToken")
    if not page_token:
        break

print(f"✅ {fotos_no_drive} fotos novas adicionadas ao cache do Drive")
print(f"💾 Cache total: {len(cache_ids)} fotos")

# salva cache atualizado
os.makedirs("data", exist_ok=True)
with open(CACHE_IDS, "w") as f:
    json.dump(cache_ids, f)

# ─── LÊ O EXCEL ─────────────────────────────────────────
print(f"\n📊 Lendo Excel...")
df = pd.read_excel(ARQUIVO_EXCEL)
print(f"✅ {len(df)} registros")

# ─── PROCESSA CADA LINHA ─────────────────────────────────
print("\n📸 Processando fotos...")
dados = []
total = baixadas = existentes = erros = 0

for i, row in df.iterrows():
    total += 1
    codigo   = row.get("codigo_unico")
    bairro   = row.get("1.4 Município_field")
    endereco = row.get("1.6 Logradouro_field")
    numero   = row.get("1.7.1 Número_field")
    foto_url = row.get("1.9.1 Tire uma foto da visita da propriedade (horizontal)_field")
    latitude  = row.get("latitude")
    longitude = row.get("longitude")

    foto_drive_url = None
    nome_arquivo = f"{codigo}.jpg"

    if isinstance(foto_url, str) and foto_url.startswith("http") and pd.notna(codigo):

        if nome_arquivo in cache_ids:
            # já existe no Drive
            file_id = cache_ids[nome_arquivo]
            foto_drive_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"
            existentes += 1
        else:
            # nova foto — baixa em memória e sobe pro Drive
            for tentativa in range(3):
                try:
                    response = requests.get(foto_url, timeout=30)
                    if response.status_code == 200:
                        media = MediaIoBaseUpload(BytesIO(response.content), mimetype="image/jpeg")
                        file = service.files().create(
                            body={"name": nome_arquivo, "parents": [pasta_fotos_id]},
                            media_body=media, fields="id"
                        ).execute()
                        file_id = file.get("id")
                        cache_ids[nome_arquivo] = file_id
                        foto_drive_url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"
                        baixadas += 1
                        print(f"  ⬆️  [{baixadas}] {nome_arquivo}")
                        break
                except Exception as e:
                    if tentativa == 2:
                        print(f"  ❌ Erro {codigo}: {e}")
                        erros += 1

    dados.append({
        "matricula": codigo,
        "bairro":    bairro,
        "endereco":  endereco,
        "numero":    numero,
        "foto":      foto_drive_url,
        "latitude":  latitude,
        "longitude": longitude,
    })

# salva cache com novas fotos
with open(CACHE_IDS, "w") as f:
    json.dump(cache_ids, f)

# ─── CRIA BANCO ─────────────────────────────────────────
print("\n📦 Criando banco SQLite...")
os.makedirs("assets", exist_ok=True)
df_final = pd.DataFrame(dados)
conn = sqlite3.connect("assets/base.db")
df_final.to_sql("casas", conn, if_exists="replace", index=False)
conn.close()
print("✅ Banco criado!")

# ─── SOBE BANCO E VERSÃO ────────────────────────────────
upload_arquivo_local(service, "assets/base.db", "base.db", PASTA_DRIVE_ID)

versao_atual = get_versao_atual(service, PASTA_DRIVE_ID)
nova_versao  = versao_atual + 1
with open("data/versao.json", "w") as f:
    json.dump({"versao": nova_versao}, f)
upload_arquivo_local(service, "data/versao.json", "versao.json", PASTA_DRIVE_ID, "application/json")

# ─── RELATÓRIO ───────────────────────────────────────────
print(f"""
✅ FINALIZADO — versão {nova_versao} publicada!
📊 Total registros : {total}
⬆️  Fotos novas     : {baixadas}
⏩ Já no Drive     : {existentes}
❌ Erros           : {erros}
""")


#%%