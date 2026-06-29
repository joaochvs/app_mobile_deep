import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { initDatabase } from '../utils/initDatabase';

const VERSION_URL = "https://drive.google.com/uc?export=download&id=1iCMp0Xw0TZaUTB1Ye5WZ6N3oWKqkkiHR";
const DB_URL = "https://drive.google.com/uc?export=download&id=1EZD9pbyZNDkzC36M4JDuPLnrcbksx-94";

// ─── CORES DEEP ──────────────────────────────────────────
const C = {
  azul:     '#2D3580',
  laranja:  '#F5A623',
  branco:   '#FFFFFF',
  cinzaClaro: '#F4F6FB',
  cinzaMedio: '#E8ECF4',
  cinzaTexto: '#8A93B2',
  preto:    '#1A1F3C',
};

export default function Home() {
  const [db, setDb] = useState<any>(null);
  const [bairros, setBairros] = useState<string[]>([]);
  const [bairroSelecionado, setBairroSelecionado] = useState('');
  const [matricula, setMatricula] = useState('');
  const [resultado, setResultado] = useState<any>(null);
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [statusSync, setStatusSync] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [totalImgs, setTotalImgs] = useState(0);
  const [baixadas, setBaixadas] = useState(0);

  useEffect(() => { verificarBanco(); }, []);

  async function verificarBanco() {
    try {
      const dbPath = FileSystem.documentDirectory + "base.db";
      const versionPath = FileSystem.documentDirectory + "version.json";
      try {
        const response = await fetch(VERSION_URL);
        const remote = await response.json();
        let localVersion = 0;
        const info = await FileSystem.getInfoAsync(versionPath);
        if (info.exists) {
          const localData = await FileSystem.readAsStringAsync(versionPath);
          localVersion = JSON.parse(localData).versao;
        }
        if (remote.versao > localVersion) {
          setStatusSync("Atualizando banco de dados...");
          await FileSystem.deleteAsync(dbPath, { idempotent: true });
          await FileSystem.downloadAsync(DB_URL, dbPath);
          await FileSystem.writeAsStringAsync(versionPath, JSON.stringify(remote));
        }
      } catch { /* offline, usa local */ }
      await carregarBanco();
      setStatusSync('');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarBanco() {
    const database = await initDatabase();
    setDb(database);
    const result = await database.getAllAsync(
      `SELECT DISTINCT bairro FROM casas WHERE bairro IS NOT NULL ORDER BY bairro ASC`
    );
    setBairros(result.map((item: any) => item.bairro?.trim()));
    return database;
  }

  function abrirNoMapa(lat: number, lng: number) {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  }

  function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function baixarImagemComRetry(url: string, path: string) {
    for (let i = 0; i < 3; i++) {
      try { await FileSystem.downloadAsync(url, path); return; }
      catch { await delay(300); }
    }
  }

  async function sincronizar() {
    if (!bairroSelecionado) { setStatusSync("Selecione um bairro primeiro"); return; }
    setSincronizando(true);
    setStatusSync("Baixando imagens do bairro...");
    await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + "fotos", { intermediates: true });
    const result = await db.getAllAsync(
      "SELECT foto FROM casas WHERE UPPER(bairro)=UPPER(?)", [bairroSelecionado]
    );
    const fotos = result.filter((i: any) => i.foto);
    setTotalImgs(fotos.length);
    setBaixadas(0);
    let count = 0;
    const LIMITE = 3;
    for (let i = 0; i < fotos.length; i += LIMITE) {
      const lote = fotos.slice(i, i + LIMITE);
      await Promise.all(lote.map(async (item: any) => {
        const parts = item.foto.split("id=");
        if (parts.length < 2) return;
        const id = parts[1].split("&")[0];
        const url = `https://drive.google.com/thumbnail?id=${id}&sz=w500`;
        const path = FileSystem.documentDirectory + "fotos/" + id + ".jpg";
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) await baixarImagemComRetry(url, path);
        count++;
        setBaixadas(count);
      }));
      await delay(150);
    }
    setStatusSync("Bairro sincronizado!");
    setSincronizando(false);
    setTimeout(() => { setStatusSync(''); setTotalImgs(0); setBaixadas(0); }, 3000);
  }

  async function buscar() {
    if (!matricula.trim()) return;
    setBuscando(true);
    setResultado(null);
    setFotoUri(null);
    const result = await db.getAllAsync(
      'SELECT * FROM casas WHERE matricula = ?', [matricula.trim()]
    );
    if (result.length > 0) {
      const item = result[0];
      setResultado(item);
      if (item.foto) {
        const parts = item.foto.split("id=");
        if (parts.length >= 2) {
          const id = parts[1].split("&")[0];
          const localPath = FileSystem.documentDirectory + "fotos/" + id + ".jpg";
          const info = await FileSystem.getInfoAsync(localPath);
          setFotoUri(info.exists
            ? localPath
            : `https://drive.google.com/thumbnail?id=${id}&sz=w500`
          );
        }
      }
    }
    setBuscando(false);
  }

  if (carregando) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0E2E" />
        <Image
          source={require('../../assets/images/splash-logo.png')}
          style={{ width: 220, height: 220 }}
          resizeMode="contain"
        />
        <ActivityIndicator color={C.laranja} size="large" style={{ marginTop: 32 }} />
        {statusSync ? <Text style={styles.splashStatus}>{statusSync}</Text> : null}
      </View>
    );
}

  const percentual = totalImgs > 0 ? Math.round((baixadas / totalImgs) * 100) : 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flex: 1, backgroundColor: C.cinzaClaro }}>
        <StatusBar barStyle="light-content" backgroundColor={C.azul} />

        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>deep</Text>
            <View style={styles.logoArc} />
          </View>
          <Text style={styles.headerSub}>Consulta de Imóveis</Text>
        </View>


      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* CARD BUSCA */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>MATRÍCULA</Text>
          <TextInput
            placeholder="Ex: CARAÇA_0002"
            placeholderTextColor={C.cinzaTexto}
            value={matricula}
            onChangeText={setMatricula}
            style={styles.input}
            autoCapitalize="characters"
            returnKeyType="search"
            onSubmitEditing={buscar}
          />
          <Pressable
            style={({ pressed }) => [styles.btnPrimario, pressed && { opacity: 0.85 }]}
            onPress={buscar}
          >
            {buscando
              ? <ActivityIndicator color={C.branco} />
              : <Text style={styles.btnPrimarioTexto}>Buscar</Text>
            }
          </Pressable>
        </View>

        {/* RESULTADO */}
        {resultado ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>RESULTADO</Text>

            <View style={styles.infoRow}>
              <View style={styles.infoIconBox}>
                <Text style={styles.infoIcon}>📍</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Endereço</Text>
                <Text style={styles.infoValor}>{resultado.endereco}</Text>
              </View>
            </View>

            <View style={[styles.infoRow, { marginTop: 12 }]}>
              <View style={styles.infoIconBox}>
                <Text style={styles.infoIcon}>🏠</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Número</Text>
                <Text style={styles.infoValor}>{resultado.numero ?? '—'}</Text>
              </View>
            </View>

            {fotoUri ? (
              <Image source={{ uri: fotoUri }} style={styles.foto} resizeMode="cover" />
            ) : (
              <View style={styles.semFoto}>
                <Text style={styles.semFotoTexto}>Sem foto disponível</Text>
              </View>
            )}

            {resultado.latitude ? (
              <Pressable
                style={({ pressed }) => [styles.btnSecundario, pressed && { opacity: 0.85 }]}
                onPress={() => abrirNoMapa(resultado.latitude, resultado.longitude)}
              >
                <Text style={styles.btnSecundarioTexto}>📍  Ver no Mapa</Text>
              </Pressable>
            ) : null}
          </View>
        ) : matricula && !buscando ? (
          <View style={styles.card}>
            <Text style={styles.vazio}>Nenhum imóvel encontrado</Text>
            <Text style={styles.vazioSub}>Verifique a matrícula e tente novamente</Text>
          </View>
        ) : null}

        {/* CARD SINCRONIZAÇÃO */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SINCRONIZAR BAIRRO</Text>
          <Text style={styles.syncDesc}>
            Baixe as imagens de um bairro para usar offline no campo.
          </Text>

          <View style={styles.pickerBox}>
            <Picker
              selectedValue={bairroSelecionado}
              onValueChange={setBairroSelecionado}
              style={{ color: C.preto }}
            >
              <Picker.Item label="Selecione um bairro..." value="" color={C.cinzaTexto} />
              {bairros.map((b, i) => (
                <Picker.Item key={i} label={b} value={b} color={C.preto} />
              ))}
            </Picker>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btnSync,
              sincronizando && styles.btnSyncAtivo,
              pressed && { opacity: 0.85 }
            ]}
            onPress={sincronizar}
            disabled={sincronizando}
          >
            {sincronizando
              ? <ActivityIndicator color={C.branco} />
              : <Text style={styles.btnSyncTexto}>⬇  Sincronizar imagens</Text>
            }
          </Pressable>

          {statusSync ? (
            <Text style={styles.statusTxt}>{statusSync}</Text>
          ) : null}

          {totalImgs > 0 && (
            <View style={{ marginTop: 12 }}>
              <View style={styles.progressoRow}>
                <Text style={styles.progressoTxt}>{baixadas} de {totalImgs} imagens</Text>
                <Text style={[styles.progressoTxt, { color: C.laranja, fontWeight: '700' }]}>
                  {percentual}%
                </Text>
              </View>
              <View style={styles.barraFundo}>
                <View style={[styles.barraProgresso, { width: `${percentual}%` as any }]} />
              </View>
            </View>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  // ── splash ──────────────────────────────────────────────
  splash: {
    flex: 1,
    backgroundColor: '#0A0E2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashStatus: {
    color: C.branco,
    opacity: 0.7,
    marginTop: 16,
    fontSize: 14,
  },

  // ── logo ────────────────────────────────────────────────
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    color: C.branco,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  logoArc: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3.5,
    borderColor: C.laranja,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
    transform: [{ rotate: '45deg' }],
  },

  // ── header ──────────────────────────────────────────────
  header: {
    backgroundColor: C.azul,
    paddingTop: Platform.OS === 'android' ? 48 : 56,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSub: {
    color: C.branco,
    opacity: 0.7,
    fontSize: 13,
    fontWeight: '500',
  },

  // ── scroll / cards ──────────────────────────────────────
  scroll: {
    padding: 16,
    paddingTop: 20,
  },
  card: {
    backgroundColor: C.branco,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: C.azul,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.cinzaTexto,
    letterSpacing: 1.2,
    marginBottom: 14,
  },

  // ── busca ───────────────────────────────────────────────
  input: {
    backgroundColor: C.cinzaClaro,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: C.preto,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: C.cinzaMedio,
  },
  btnPrimario: {
    backgroundColor: C.azul,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPrimarioTexto: {
    color: C.branco,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },

  // ── resultado ───────────────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoIconBox: {
    width: 40,
    height: 40,
    backgroundColor: C.cinzaClaro,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoIcon: { fontSize: 18 },
  infoLabel: {
    fontSize: 11,
    color: C.cinzaTexto,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValor: {
    fontSize: 15,
    color: C.preto,
    fontWeight: '600',
  },
  foto: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    marginTop: 16,
    backgroundColor: C.cinzaMedio,
  },
  semFoto: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    marginTop: 16,
    backgroundColor: C.cinzaClaro,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.cinzaMedio,
    borderStyle: 'dashed',
  },
  semFotoTexto: {
    color: C.cinzaTexto,
    fontSize: 14,
  },
  btnSecundario: {
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.azul,
  },
  btnSecundarioTexto: {
    color: C.azul,
    fontWeight: '700',
    fontSize: 15,
  },

  // ── vazio ───────────────────────────────────────────────
  vazio: {
    color: C.preto,
    fontWeight: '700',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 4,
  },
  vazioSub: {
    color: C.cinzaTexto,
    fontSize: 13,
    textAlign: 'center',
  },

  // ── sync ────────────────────────────────────────────────
  syncDesc: {
    color: C.cinzaTexto,
    fontSize: 13,
    marginBottom: 14,
    lineHeight: 19,
  },
  pickerBox: {
    backgroundColor: C.cinzaClaro,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.cinzaMedio,
    marginBottom: 12,
    overflow: 'hidden',
  },
  btnSync: {
    backgroundColor: C.laranja,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSyncAtivo: {
    opacity: 0.8,
  },
  btnSyncTexto: {
    color: C.branco,
    fontWeight: '700',
    fontSize: 15,
  },
  statusTxt: {
    color: C.cinzaTexto,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  progressoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressoTxt: {
    fontSize: 13,
    color: C.cinzaTexto,
    fontWeight: '600',
  },
  barraFundo: {
    height: 8,
    backgroundColor: C.cinzaMedio,
    borderRadius: 4,
  },
  barraProgresso: {
    height: 8,
    backgroundColor: C.laranja,
    borderRadius: 4,
  },
});
