import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { initDatabase } from '../utils/initDatabase';

// ─── CONFIGURAÇÃO — GOOGLE DRIVE ──────────────────────────
// 🔥 Substitua pelos IDs reais dos arquivos no Drive.
// Esses IDs ficam FIXOS entre atualizações, porque o script Python
// faz update no mesmo arquivo (files().update), não cria um novo.
//
// Como pegar o ID: abra o arquivo no Drive, clique em "Compartilhar"
// → "Qualquer pessoa com o link" → Leitor, copie o link, e pegue o
// trecho entre "/d/" e "/view" (ou o parâmetro "id=" se o link já vier nesse formato).
const BASE_DB_FILE_ID    = "1EZD9pbyZNDkzC36M4JDuPLnrcbksx-94";
const VERSAO_FILE_ID     = "1iCMp0Xw0TZaUTB1Ye5WZ6N3oWKqkkiHR";

const VERSION_URL = `https://drive.google.com/uc?export=download&id=${VERSAO_FILE_ID}`;
const DB_URL      = `https://drive.google.com/uc?export=download&id=${BASE_DB_FILE_ID}`;
// FOTOS_BASE_URL não é mais necessário — a URL completa de cada foto
// já vem pronta no banco (coluna "foto"), gerada pelo script Python:
// https://drive.google.com/thumbnail?id=...&sz=w1000

// adiciona parâmetro de cache-busting respeitando se a URL já tem "?"
function comCacheBusting(url: string) {
  const separador = url.includes('?') ? '&' : '?';
  return `${url}${separador}t=${Date.now()}`;
}

// ─── CORES ───────────────────────────────────────────────
const C = {
  azul:          '#2D3580',
  laranja:       '#F5A623',
  branco:        '#FFFFFF',
  cinzaClaro:    '#F4F6FB',
  cinzaMedio:    '#E8ECF4',
  cinzaTexto:    '#8A93B2',
  preto:         '#1A1F3C',
  vermelho:      '#D0423A',
  vermelhoFundo: '#FFF0F0',
  verde:         '#2E9E5B',
  verdeFundo:    '#EAFBF1',
};

// ─── TIPO DE STATUS DA VERIFICAÇÃO ───────────────────────
type TipoVerificacao = 'checking' | 'updating' | 'success' | 'offline' | 'idle';

// ─── UTILITÁRIO: testa se há internet ────────────────────
async function testarConectividade(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

export default function Home() {
  const [db, setDb]                           = useState<any>(null);
  const dbRef                                  = useRef<any>(null); // espelha "db" para uso em closures (AppState listener)
  const [bairros, setBairros]                 = useState<string[]>([]);
  const [bairroSelecionado, setBairroSelecionado] = useState('');
  const [modalBairroVisivel, setModalBairroVisivel] = useState(false);
  const [matricula, setMatricula]             = useState('');
  const [resultado, setResultado]             = useState<any>(null);
  const [fotoUri, setFotoUri]                 = useState<string | null>(null);

  // ── status da verificação/atualização do banco (banner no topo) ──
  const [statusVerificacao, setStatusVerificacao] = useState('');
  const [tipoVerificacao, setTipoVerificacao]      = useState<TipoVerificacao>('idle');

  // ── status da sincronização de fotos por bairro (card específico) ──
  const [statusSync, setStatusSync]           = useState('');
  const [erroSync, setErroSync]               = useState('');

  const [carregando, setCarregando]           = useState(true);
  const [sincronizando, setSincronizando]     = useState(false);
  const [buscando, setBuscando]               = useState(false);
  const [totalImgs, setTotalImgs]             = useState(0);
  const [baixadas, setBaixadas]               = useState(0);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // primeira abertura do app (cold start) — mostra splash completo
    verificarBanco(true);

    // 🔥 sempre que o app volta a ficar ativo (sair do background/inativo),
    // verifica de novo — sem mostrar o splash, só o banner no topo
    const subscription = AppState.addEventListener('change', (nextState) => {
      const estavaEmSegundoPlano = appStateRef.current.match(/inactive|background/);
      if (estavaEmSegundoPlano && nextState === 'active') {
        verificarBanco(false);
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  // ─── BANNER DE STATUS ──────────────────────────────────
  function mostrarStatus(mensagem: string, tipo: TipoVerificacao, autoOcultar = false) {
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    setStatusVerificacao(mensagem);
    setTipoVerificacao(tipo);
    if (autoOcultar) {
      bannerTimeoutRef.current = setTimeout(() => {
        setStatusVerificacao('');
        setTipoVerificacao('idle');
      }, 3000);
    }
  }

  // ─── FECHA CONEXÃO ATUAL DO BANCO (se houver) ─────────
  async function fecharBancoAtual() {
    if (dbRef.current) {
      try { await dbRef.current.closeAsync(); } catch {}
    }
  }

  // ─── VERIFICAÇÃO / ATUALIZAÇÃO DO BANCO ───────────────
  // inicial=true  → cold start, mostra splash de carregamento
  // inicial=false → app voltou do background, mostra só o banner no topo
  async function verificarBanco(inicial: boolean) {
    if (inicial) setCarregando(true);
    mostrarStatus("Procurando atualizações...", 'checking');

    try {
      const dbPath      = FileSystem.documentDirectory + "base.db";
      const versionPath = FileSystem.documentDirectory + "version.json";

      const online = await testarConectividade();

      if (!online) {
        mostrarStatus("Sem internet — não foi possível verificar atualizações.", 'offline', true);
        await carregarBanco();
        return;
      }

      try {
        // cache-busting: garante que pega a versão real do Drive,
        // não uma resposta cacheada pelo SO/CDN
        const response = await fetch(comCacheBusting(VERSION_URL), {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        });
        const remote      = await response.json();
        let localVersion  = 0;
        const info        = await FileSystem.getInfoAsync(versionPath);
        if (info.exists) {
          const localData = await FileSystem.readAsStringAsync(versionPath);
          localVersion    = JSON.parse(localData).versao;
        }

        if (remote.versao > localVersion) {
          mostrarStatus("Atualizando banco de dados...", 'updating');

          // fecha conexão aberta antes de mexer no arquivo físico
          await fecharBancoAtual();

          await FileSystem.deleteAsync(dbPath, { idempotent: true });
          await FileSystem.deleteAsync(dbPath + "-wal", { idempotent: true });
          await FileSystem.deleteAsync(dbPath + "-shm", { idempotent: true });

          await FileSystem.downloadAsync(comCacheBusting(DB_URL), dbPath);
          await FileSystem.writeAsStringAsync(versionPath, JSON.stringify(remote));

          mostrarStatus("Banco atualizado com sucesso!", 'success', true);
        } else {
          mostrarStatus("Nenhuma atualização disponível.", 'success', true);
        }
      } catch {
        mostrarStatus("Não foi possível verificar atualizações agora.", 'offline', true);
      }

      await carregarBanco();
    } finally {
      if (inicial) setCarregando(false);
    }
  }

  async function carregarBanco() {
    const database = await initDatabase();
    dbRef.current = database;
    setDb(database);
    const result = await database.getAllAsync(
      `SELECT DISTINCT bairro FROM casas WHERE bairro IS NOT NULL`
    );
    const lista = result
      .map((item: any) => item.bairro?.trim())
      .filter(Boolean)
      .sort((a: string, b: string) =>
        a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
      );
    setBairros(lista);
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

  // ─── SINCRONIZAR FOTOS DO BAIRRO ───────────────────────
  async function sincronizar() {
    if (!bairroSelecionado) {
      setErroSync("Selecione um bairro primeiro.");
      return;
    }

    setErroSync('');
    setStatusSync('');
    setSincronizando(true);
    setStatusSync("Verificando conexão...");

    const online = await testarConectividade();

    if (!online) {
      setErroSync("Sem conexão com a internet. Verifique sua rede e tente novamente.");
      setStatusSync('');
      setSincronizando(false);
      return;
    }

    setStatusSync("Baixando imagens do bairro...");
    await FileSystem.makeDirectoryAsync(
      FileSystem.documentDirectory + "fotos",
      { intermediates: true }
    );

    const result = await db.getAllAsync(
      "SELECT foto FROM casas WHERE UPPER(bairro)=UPPER(?)", [bairroSelecionado]
    );
    const fotos = result.filter((i: any) => i.foto);
    setTotalImgs(fotos.length);
    setBaixadas(0);

    let count      = 0;
    const LIMITE   = 3;

    for (let i = 0; i < fotos.length; i += LIMITE) {
      const lote = fotos.slice(i, i + LIMITE);
      await Promise.all(lote.map(async (item: any) => {
        // a coluna "foto" já contém a URL completa do Google Drive
        // (ex: https://drive.google.com/thumbnail?id=XXXX&sz=w1000)
        const parts = item.foto.split("id=");
        if (parts.length < 2) return;
        const id   = parts[1].split("&")[0];
        const url  = item.foto; // usa a URL real armazenada no banco
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
    setTimeout(() => {
      setStatusSync('');
      setTotalImgs(0);
      setBaixadas(0);
    }, 3000);
  }

  // ─── BUSCA ────────────────────────────────────────────
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
          const id        = parts[1].split("&")[0];
          const localPath = FileSystem.documentDirectory + "fotos/" + id + ".jpg";
          const info      = await FileSystem.getInfoAsync(localPath);
          setFotoUri(
            info.exists
              ? localPath
              : item.foto // usa a URL do Drive direto se não tiver baixado ainda
          );
        }
      }
    }
    setBuscando(false);
  }

  // ─── SPLASH (apenas no cold start) ────────────────────
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
        {statusVerificacao ? <Text style={styles.splashStatus}>{statusVerificacao}</Text> : null}
      </View>
    );
  }

  const percentual = totalImgs > 0 ? Math.round((baixadas / totalImgs) * 100) : 0;

  // ── estilo do banner conforme o tipo de status ──
  const bannerEstilo = {
    checking: { bg: C.cinzaMedio, txt: C.preto },
    updating: { bg: '#FFF6E5', txt: '#8A6A1E' },
    success:  { bg: C.verdeFundo, txt: C.verde },
    offline:  { bg: C.vermelhoFundo, txt: C.vermelho },
    idle:     { bg: C.cinzaMedio, txt: C.preto },
  }[tipoVerificacao];

  return (
    <View style={{ flex: 1, backgroundColor: C.cinzaClaro }}>
      <StatusBar barStyle="light-content" backgroundColor={C.azul} />

      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>deep</Text>
          <View style={styles.logoArc} />
        </View>
        <Text style={styles.headerSub}>Consulta de Matrículas</Text>
      </View>

      {/* 🔥 BANNER DE STATUS — sempre visível, fora do scroll, mostra
          o que está acontecendo com a verificação do banco */}
      {statusVerificacao ? (
        <View style={[styles.banner, { backgroundColor: bannerEstilo.bg }]}>
          {(tipoVerificacao === 'checking' || tipoVerificacao === 'updating') ? (
            <ActivityIndicator size="small" color={bannerEstilo.txt} style={{ marginRight: 8 }} />
          ) : null}
          <Text style={[styles.bannerTexto, { color: bannerEstilo.txt }]}>
            {statusVerificacao}
          </Text>
        </View>
      ) : null}

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

          {/* BOTÃO QUE ABRE O MODAL */}
          <Pressable
            style={styles.seletorBairro}
            onPress={() => setModalBairroVisivel(true)}
          >
            <Text style={[
              styles.seletorBairroTexto,
              !bairroSelecionado && { color: C.cinzaTexto },
            ]}>
              {bairroSelecionado || 'Selecione um bairro...'}
            </Text>
            <Text style={{ color: C.cinzaTexto, fontSize: 16 }}>▾</Text>
          </Pressable>

          {/* MODAL CUSTOMIZADO — fundo branco, letras pretas */}
          <Modal
            visible={modalBairroVisivel}
            transparent
            animationType="slide"
            onRequestClose={() => setModalBairroVisivel(false)}
          >
            <Pressable
              style={styles.modalOverlay}
              onPress={() => setModalBairroVisivel(false)}
            >
              <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitulo}>Selecione um bairro</Text>
                  <Pressable onPress={() => setModalBairroVisivel(false)}>
                    <Text style={{ color: C.cinzaTexto, fontSize: 22, lineHeight: 26 }}>✕</Text>
                  </Pressable>
                </View>

                <FlatList
                  data={bairros}
                  keyExtractor={(_, i) => String(i)}
                  ItemSeparatorComponent={() => <View style={styles.modalSeparador} />}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.modalItem,
                        bairroSelecionado === item && styles.modalItemSelecionado,
                      ]}
                      onPress={() => {
                        setBairroSelecionado(item);
                        setErroSync('');
                        setModalBairroVisivel(false);
                      }}
                    >
                      <Text style={[
                        styles.modalItemTexto,
                        bairroSelecionado === item && styles.modalItemTextoSelecionado,
                      ]}>
                        {item}
                      </Text>
                      {bairroSelecionado === item && (
                        <Text style={{ color: C.azul, fontSize: 18 }}>✓</Text>
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </Pressable>
          </Modal>

          <Pressable
            style={({ pressed }) => [
              styles.btnSync,
              sincronizando && styles.btnSyncAtivo,
              pressed && { opacity: 0.85 },
            ]}
            onPress={sincronizar}
            disabled={sincronizando}
          >
            {sincronizando
              ? <ActivityIndicator color={C.branco} />
              : <Text style={styles.btnSyncTexto}>⬇  Sincronizar imagens</Text>
            }
          </Pressable>

          {/* ERRO */}
          {erroSync ? (
            <View style={styles.erroBox}>
              <Text style={styles.erroTexto}>⚠️  {erroSync}</Text>
            </View>
          ) : null}

          {/* STATUS */}
          {statusSync && !erroSync ? (
            <Text style={styles.statusTxt}>{statusSync}</Text>
          ) : null}

          {/* PROGRESSO */}
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
    textAlign: 'center',
    paddingHorizontal: 24,
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

  // ── banner de status (verificação/atualização do banco) ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerTexto: {
    fontSize: 13,
    fontWeight: '600',
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

  // ── seletor de bairro customizado ───────────────────────
  seletorBairro: {
    backgroundColor: C.cinzaClaro,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.cinzaMedio,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  seletorBairroTexto: {
    fontSize: 15,
    color: C.preto,
    fontWeight: '500',
    flex: 1,
  },

  // ── modal de seleção ────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,31,60,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: C.branco,
    borderRadius: 20,
    maxHeight: '65%',
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.cinzaMedio,
  },
  modalTitulo: {
    fontSize: 16,
    fontWeight: '700',
    color: C.preto,
  },
  modalSeparador: {
    height: 1,
    backgroundColor: C.cinzaMedio,
    marginHorizontal: 20,
  },
  modalItem: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.branco,
  },
  modalItemSelecionado: {
    backgroundColor: '#EEF1FB',
  },
  modalItemTexto: {
    fontSize: 15,
    color: C.preto,
    fontWeight: '500',
  },
  modalItemTextoSelecionado: {
    color: C.azul,
    fontWeight: '700',
  },

  // ── erro ────────────────────────────────────────────────
  erroBox: {
    marginTop: 12,
    backgroundColor: C.vermelhoFundo,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#F5C5C3',
  },
  erroTexto: {
    color: C.vermelho,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },

  // ── progresso ───────────────────────────────────────────
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