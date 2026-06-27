#%%
import pandas as pd
import sqlite3
import json
import os
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
import pickle

# ─── CONFIGURAÇÃO ───────────────────────────────────────
PASTA_DRIVE_ID = "1EdRItu4bu-dsbn_lIIxSqbATihyvmzmb"
# ────────────────────────────────────────────────────────

# ✅ LOGIN GOOGLE
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


# ✅ UPLOAD (RETORNANDO ID)
def upload_arquivo(service, caminho_local, nome_no_drive, pasta_id, mimetype="application/octet-stream"):

    if not os.path.exists(caminho_local):
        print(f"❌ Arquivo não encontrado: {caminho_local}")
        return None

    resultado = service.files().list(
        q=f"name='{nome_no_drive}' and '{pasta_id}' in parents and trashed=false",
        fields="files(id, name)"
    ).execute()

    media = MediaFileUpload(caminho_local, mimetype=mimetype)

    # 🔥 CASO ESPECIAL: base.db e versao.json → SEMPRE atualizar
    if nome_no_drive in ["base.db", "versao.json"]:
        if resultado["files"]:
            file_id = resultado["files"][0]["id"]

            service.files().update(
                fileId=file_id,
                media_body=media
            ).execute()

            print(f"🔄 Atualizado: {nome_no_drive}")
            return file_id

    # ✅ PARA FOTOS (não reup)
    if resultado["files"]:
        file_id = resultado["files"][0]["id"]
        print(f"⏩ Já existe: {nome_no_drive}")
        return file_id

    # ✅ cria novo
    file = service.files().create(
        body={
            "name": nome_no_drive,
            "parents": [pasta_id]
        },
        media_body=media
    ).execute()

    print(f"⬆️ Enviado: {nome_no_drive}")
    return file.get("id")


# ✅ VERSÃO
def get_versao_atual(service, pasta_id):
    resultado = service.files().list(
        q=f"name='versao.json' and '{pasta_id}' in parents and trashed=false",
        fields="files(id)"
    ).execute()

    if resultado["files"]:
        file_id = resultado["files"][0]["id"]
        content = service.files().get_media(fileId=file_id).execute()
        dados = json.loads(content)
        return dados.get("versao", 0)

    return 0


# ─── INÍCIO DO SCRIPT ───────────────────────────────────

print("☁️ Conectando ao Drive...")
service = get_drive_service()

# ─── PASTA DE FOTOS NO DRIVE ────────────────────────────
pasta_fotos_resultado = service.files().list(
    q=f"name='fotos' and '{PASTA_DRIVE_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields="files(id)"
).execute()

if pasta_fotos_resultado["files"]:
    pasta_fotos_id = pasta_fotos_resultado["files"][0]["id"]
else:
    pasta_meta = {
        "name": "fotos",
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [PASTA_DRIVE_ID]
    }
    pasta_fotos = service.files().create(body=pasta_meta, fields="id").execute()
    pasta_fotos_id = pasta_fotos["id"]


# ─── SUBIR FOTOS E PEGAR IDS ────────────────────────────

print("\n📸 Subindo fotos...")

fotos = [
    f for f in os.listdir("fotos")
    if f.lower().endswith((".jpg", ".jpeg", ".png"))
]

mapa_ids = {}

for i, foto in enumerate(fotos):
    caminho = f"fotos/{foto}"

    file_id = upload_arquivo(service, caminho, foto, pasta_fotos_id, mimetype="image/jpeg")

    if file_id:
        mapa_ids[foto] = file_id

    print(f"📤 [{i+1}/{len(fotos)}] {foto}")


# ─── CRIAR BANCO COM URL ────────────────────────────────

print("\n📦 Criando banco com URL das imagens...")

df = pd.read_excel("data/base_limpa.xlsx")

# ✅ FUNÇÃO QUE GERA URL CORRETA
def gerar_url(nome_arquivo):

    # ✅ trata valores nulos (NaN)
    if pd.isna(nome_arquivo):
        return None

    # ✅ garante que é string
    nome_arquivo = str(nome_arquivo)

    # ✅ remove "fotos/"
    nome_limpo = nome_arquivo.split("/")[-1]

    file_id = mapa_ids.get(nome_limpo)

    if file_id:
        return f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"

    return None

# ⚠️ AJUSTA AQUI SE O NOME DA COLUNA FOR DIFERENTE
df["foto"] = df["foto"].apply(gerar_url)


# ✅ SALVAR BANCO
conn = sqlite3.connect("assets/base.db")
df.to_sql("casas", conn, if_exists="replace", index=False)
conn.close()

print("✅ Banco criado com URLs!")


# ─── SUBIR BANCO ────────────────────────────────────────

upload_arquivo(service, "assets/base.db", "base.db", PASTA_DRIVE_ID)


# ─── ATUALIZAR VERSÃO ───────────────────────────────────

versao_atual = get_versao_atual(service, PASTA_DRIVE_ID)
nova_versao = versao_atual + 1

versao_json = {"versao": nova_versao}

with open("data/versao.json", "w") as f:
    json.dump(versao_json, f)

upload_arquivo(service, "data/versao.json", "versao.json", PASTA_DRIVE_ID)

print(f"\n✅ FINALIZADO — versão {nova_versao} publicada!")
#%%