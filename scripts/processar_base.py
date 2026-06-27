#%%
import pandas as pd
import requests
import os

# cria pasta de fotos
os.makedirs("fotos", exist_ok=True)

arquivo_excel = r"C:\Users\jp\Desktop\app_mobile_deep\data\REVISITAS_CENSO.xlsx"

df = pd.read_excel(arquivo_excel)

dados = []

# ✅ CONTADORES
total = 0
baixadas = 0
existentes = 0
erros = 0

for i, row in df.iterrows():
    total += 1

    codigo = row.get("codigo_unico")
    bairro = row.get("1.5 Bairro_field")    
    endereco = row.get("1.6 Logradouro_field")
    numero = row.get("1.7.1 Número_field")
    foto_url = row.get("1.9.1 Tire uma foto da visita da propriedade (horizontal)_field")    
    latitude = row.get("latitude")
    longitude = row.get("longitude")



    caminho_foto = None

    if isinstance(foto_url, str) and foto_url.startswith("http") and pd.notna(codigo):
        
        nome_arquivo = f"fotos/{codigo}.jpg"

        # ✅ já existe
        if os.path.exists(nome_arquivo):
            caminho_foto = nome_arquivo
            existentes += 1

        else:
            # ✅ tentar baixar
            for tentativa in range(3):
                try:
                    response = requests.get(foto_url, timeout=30)

                    if response.status_code == 200:
                        with open(nome_arquivo, "wb") as f:
                            f.write(response.content)

                        caminho_foto = nome_arquivo
                        baixadas += 1
                        break

                except Exception as e:
                    if tentativa == 2:
                        print(f"❌ Erro ao baixar imagem {codigo}: {e}")
                        erros += 1

    dados.append({
        "matricula": codigo,
        "bairro" : bairro,
        "endereco": endereco,
        "numero": numero,
        "foto": caminho_foto,
        "latitude": latitude,
        "longitude": longitude
    })

df_final = pd.DataFrame(dados)
df_final.to_excel("data/base_limpa.xlsx", index=False)


# ✅ RELATÓRIO FINAL
print("\n✅ FINALIZADO")
print(f"📊 Total registros: {total}")
print(f"⬇️ Fotos baixadas agora: {baixadas}")
print(f"📁 Fotos já existentes: {existentes}")
print(f"❌ Erros: {erros}")
print(f"📦 Total com foto: {baixadas + existentes}")
# %%
