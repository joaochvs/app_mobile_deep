import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// 🔥 NOVO: envolve qualquer Promise com um limite de tempo.
// Sem isso, uma operação de rede/arquivo que trava (ex: conexão instável,
// query presa no SQLite) deixa a tela em "carregando" para sempre,
// e o usuário precisa fechar o app pra sair do estado travado.
function comTimeout<T>(promise: Promise<T>, ms: number, mensagemErro: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(mensagemErro)), ms);
    promise.then(
      (valor) => { clearTimeout(timer); resolve(valor); },
      (erro) => { clearTimeout(timer); reject(erro); }
    );
  });
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

// 🔥 checa se tem uma atualização OTA (eas update) disponível e aplica.
// Isso evita depender só do usuário fechar e reabrir o app do zero —
// se ele já está com o app aberto, essa função busca e aplica na hora
// (e reinicia o app sozinho pra carregar o JS novo).
// Retorna uma mensagem descrevendo o que aconteceu, pra quem chamar
// poder exibir isso na tela (ex: o botão de debug).
async function verificarAtualizacaoOTA(): Promise<string> {
  // em desenvolvimento (Expo Go / dev client) o expo-updates não funciona
  // de verdade — só faz sentido em builds de preview/produção
  if (__DEV__) {
    return 'Updates OTA não funcionam em modo desenvolvimento (Expo Go / dev client). Teste num build de preview ou produção instalado no aparelho.';
  }
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      // reloadAsync reinicia o app — o texto abaixo nem chega a aparecer
      // na prática, mas deixamos por segurança
      await Updates.reloadAsync();
      return 'Atualização encontrada e aplicada! Reiniciando o app...';
    }
    return 'Nenhuma atualização nova disponível — você já está na versão mais recente.';
  } catch (e: any) {
    console.log('Erro ao checar atualização OTA:', e);
    return `Erro ao checar atualização: ${e?.message ?? 'desconhecido'}`;
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
  const [erroBusca, setErroBusca]             = useState('');

  // ── debug de versão/update (acesso escondido, só pra você) ──
  const [modalDebugVisivel, setModalDebugVisivel] = useState(false);
  const [checandoUpdate, setChecandoUpdate]       = useState(false);
  const [statusUpdateDebug, setStatusUpdateDebug] = useState('');
  const toquesLogoRef = useRef(0);
  const toquesLogoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function aoTocarNoLogo() {
    toquesLogoRef.current += 1;
    if (toquesLogoTimeoutRef.current) clearTimeout(toquesLogoTimeoutRef.current);

    if (toquesLogoRef.current >= 5) {
      toquesLogoRef.current = 0;
      setModalDebugVisivel(true);
      return;
    }

    // se passar 1.5s sem tocar de novo, zera a contagem
    toquesLogoTimeoutRef.current = setTimeout(() => {
      toquesLogoRef.current = 0;
    }, 1500);
  }

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

  // 🔥 NOVOS REFS DE CONTROLE
  // Cada vez que o usuário dispara uma busca/sincronização, incrementamos o
  // "id" correspondente. Se um resultado antigo chegar depois de um id mais
  // novo já ter sido gerado, ele é simplesmente descartado — na prática isso
  // cancela a busca anterior quando o usuário clica de novo.
  const searchIdRef      = useRef(0);
  const syncIdRef         = useRef(0);
  const verificandoRef    = useRef(false); // evita 2 verificações de banco simultâneas
  const sincronizandoRef  = useRef(false); // espelha "sincronizando" para uso em closures

  useEffect(() => {
    // 🔥 checa se tem atualização OTA (código novo publicado via eas update)
    // assim que o app abre. Não bloqueia nada — roda em paralelo.
    verificarAtualizacaoOTA();

    // primeira abertura do app (cold start) — mostra splash completo
    verificarBanco(true);

    // 🔥 sempre que o app volta a ficar ativo (sair do background/inativo),
    // verifica de novo — sem mostrar o splash, só o banner no topo
    const subscription = AppState.addEventListener('change', (nextState) => {
      const estavaEmSegundoPlano = appStateRef.current.match(/inactive|background/);
      if (estavaEmSegundoPlano && nextState === 'active') {
        // 🔥 se tiver uma sincronização de fotos rolando, não mexe no banco agora
        // (evita fechar a conexão / trocar o arquivo .db no meio de uma operação)
        if (!sincronizandoRef.current) {
          verificarBanco(false);
        }
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
    if (!dbRef.current) return;

    const banco = dbRef.current;

    // Remove a referência ANTES de fechar
    dbRef.current = null;
    setDb(null);

    try {
      await banco.closeAsync();
      console.log("Banco fechado.");
    } catch (e) {
      console.log("Erro ao fechar banco:", e);
    }
  }

  // ─── VERIFICAÇÃO / ATUALIZAÇÃO DO BANCO ───────────────
  // inicial=true  → cold start, mostra splash de carregamento
  // inicial=false → app voltou do background, mostra só o banner no topo
  async function verificarBanco(inicial: boolean) {
    // 🔥 evita rodar duas verificações ao mesmo tempo (ex: usuário sai e volta
    // do app rapidamente, disparando o listener 2x em sequência)
    if (verificandoRef.current) return;
    verificandoRef.current = true;

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
        // 🔥 com timeout — sem isso, uma rede lenta trava aqui pra sempre
        const response = await comTimeout(
          fetch(comCacheBusting(VERSION_URL), {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
            },
          }),
          10000,
          'Timeout ao verificar versão do banco.'
        );
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

          await carregarBanco();

          // 🔥 com timeout — o banco pode ser um arquivo grande, mas 30s é
          // tempo suficiente pra não travar em conexões ruins
          await comTimeout(
            FileSystem.downloadAsync(comCacheBusting(DB_URL), dbPath),
            30000,
            'Timeout ao baixar o banco de dados.'
          );
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
      verificandoRef.current = false;
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
      try {
        // 🔥 com timeout por tentativa — uma foto que não baixa não pode
        // travar a sincronização inteira
        await comTimeout(FileSystem.downloadAsync(url, path), 15000, 'Timeout ao baixar imagem.');
        return;
      }
      catch { await delay(300); }
    }
  }

  // ─── SINCRONIZAR FOTOS DO BAIRRO ───────────────────────
  async function sincronizar() {
    if (!bairroSelecionado) {
      setErroSync("Selecione um bairro primeiro.");
      return;
    }

    // 🔥 novo "id" de sincronização — se essa função for chamada de novo
    // antes de terminar, a execução antiga se auto-cancela nos pontos
    // de checagem abaixo (idDoSync !== syncIdRef.current)
    const idDoSync = ++syncIdRef.current;

    setErroSync('');
    setStatusSync('');
    setSincronizando(true);
    sincronizandoRef.current = true;
    setStatusSync("Verificando conexão...");

    try {
      const online = await testarConectividade();
      if (idDoSync !== syncIdRef.current) return; // cancelado

      if (!online) {
        setErroSync("Sem conexão com a internet. Verifique sua rede e tente novamente.");
        return;
      }

      setStatusSync("Baixando imagens do bairro...");
      await FileSystem.makeDirectoryAsync(
        FileSystem.documentDirectory + "fotos",
        { intermediates: true }
      );

      if (!dbRef.current) throw new Error('Banco de dados ainda não está pronto.');

      const result = await dbRef.current.getAllAsync(
        "SELECT foto FROM casas WHERE UPPER(bairro)=UPPER(?)", [bairroSelecionado]
      );
      if (idDoSync !== syncIdRef.current) return; // cancelado

      const fotos = result.filter((i: any) => i.foto);
      setTotalImgs(fotos.length);
      setBaixadas(0);

      let count      = 0;
      const LIMITE   = 3;

      for (let i = 0; i < fotos.length; i += LIMITE) {
        if (idDoSync !== syncIdRef.current) return; // cancelado no meio do loop

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
          if (idDoSync === syncIdRef.current) setBaixadas(count);
        }));
        await delay(150);
      }

      if (idDoSync !== syncIdRef.current) return; // cancelado

      setStatusSync("Bairro sincronizado!");
      setTimeout(() => {
        if (idDoSync === syncIdRef.current) {
          setStatusSync('');
          setTotalImgs(0);
          setBaixadas(0);
        }
      }, 3000);
    } catch (e: any) {
      if (idDoSync === syncIdRef.current) {
        setErroSync(e?.message || 'Erro ao sincronizar as imagens. Tente novamente.');
      }
    } finally {
      if (idDoSync === syncIdRef.current) {
        setSincronizando(false);
        sincronizandoRef.current = false;
      }
    }
  }

  // ─── BUSCA ────────────────────────────────────────────
  async function buscar() {
    if (!matricula.trim()) return;

    // 🔥 novo "id" de busca — isso é o que resolve o loop infinito:
    // se essa mesma função for chamada de novo (usuário clicou "Buscar"
    // outra vez, ou trocou a matrícula), a busca antiga vira "obsoleta"
    // e seu resultado é ignorado quando (se) ela finalmente responder.
    const idDaBusca = ++searchIdRef.current;

    setBuscando(true);
    setResultado(null);
    setFotoUri(null);
    setErroBusca('');

    try {
    const database = dbRef.current;

    if (!database) {
      throw new Error('Banco de dados está sendo atualizado. Aguarde alguns segundos.');
    }

    const result = await database.getAllAsync(
        dbRef.current.getAllAsync('SELECT * FROM casas WHERE matricula = ?', [matricula.trim()]),
        10000,
        'A busca demorou demais e foi cancelada. Tente novamente.'
      );

      // se o usuário já iniciou outra busca enquanto esta rodava, descarta
      if (idDaBusca !== searchIdRef.current) return;

      if (result.length > 0) {
        const item = result[0];
        setResultado(item);
        if (item.foto) {
          const parts = item.foto.split("id=");
          if (parts.length >= 2) {
            const id        = parts[1].split("&")[0];
            const localPath = FileSystem.documentDirectory + "fotos/" + id + ".jpg";
            const info      = await FileSystem.getInfoAsync(localPath);
            if (idDaBusca !== searchIdRef.current) return; // cancelado nesse meio-tempo
            setFotoUri(
              info.exists
                ? localPath
                : item.foto // usa a URL do Drive direto se não tiver baixado ainda
            );
          }
        }
      }
    } catch (e: any) {
      if (idDaBusca !== searchIdRef.current) return; // busca já cancelada, ignora erro
      setErroBusca(e?.message || 'Erro ao buscar a matrícula. Tente novamente.');
    } finally {
      // só limpa o "carregando" se essa ainda for a busca mais recente —
      // senão a gente ia esconder o spinner de uma busca nova por engano
      if (idDaBusca === searchIdRef.current) setBuscando(false);
    }
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
        <Pressable onPress={aoTocarNoLogo} style={styles.logoContainer}>
          <Text style={styles.logoText}>deep</Text>
          <View style={styles.logoArc} />
        </Pressable>
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
            onChangeText={(texto) => {
              setMatricula(texto);
              if (erroBusca) setErroBusca('');
            }}
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
          {buscando ? (
            <Text style={styles.dicaCancelar}>Toque em "Buscar" de novo a qualquer momento para cancelar esta busca.</Text>
          ) : null}
          {erroBusca ? (
            <View style={styles.erroBox}>
              <Text style={styles.erroTexto}>⚠️  {erroBusca}</Text>
            </View>
          ) : null}
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
        ) : matricula && !buscando && !erroBusca ? (
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

          {/* MODAL CUSTOMIZADO — fundo branco, letras pretas
              🔥 estrutura corrigida: o fundo que fecha ao tocar (backdrop)
              agora é um elemento SEPARADO do conteúdo, não um pai dele.
              Antes o conteúdo era filho do Pressable de fechar, o que em
              alguns aparelhos Android fazia o toque nos itens de dentro
              não ser reconhecido corretamente (ficava "inclicável"). */}
          <Modal
            visible={modalBairroVisivel}
            transparent
            animationType="slide"
            onRequestClose={() => setModalBairroVisivel(false)}
          >
            <View style={styles.modalOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setModalBairroVisivel(false)}
              />
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
            </View>
          </Modal>

          <Pressable
            style={({ pressed }) => [
              styles.btnSync,
              sincronizando && styles.btnSyncAtivo,
              pressed && { opacity: 0.85 },
            ]}
            onPress={sincronizar}
          >
            {sincronizando
              ? <ActivityIndicator color={C.branco} />
              : <Text style={styles.btnSyncTexto}>⬇  Sincronizar imagens</Text>
            }
          </Pressable>
          {sincronizando ? (
            <Text style={styles.dicaCancelar}>Toque no botão de novo para cancelar esta sincronização.</Text>
          ) : null}

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

        {/* rodapé simples — só a versão, discreto, útil pra suporte
            ("qual versão você está usando?") sem poluir a tela do usuário */}
        <Text style={styles.rodapeVersao}>v{Constants.expoConfig?.version ?? '?'}</Text>

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* 🔥 MODAL DE DEBUG — só pra você. Acessado tocando 5x seguidas
          no logo "deep" no header. Mostra tudo que precisa pra confirmar
          se um "eas update" realmente chegou no aparelho. */}
      <Modal
        visible={modalDebugVisivel}
        transparent
        animationType="fade"
        onRequestClose={() => setModalDebugVisivel(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setModalDebugVisivel(false)}
          />
          <View style={styles.debugContainer}>
            <Text style={styles.modalTitulo}>Debug — informações do build</Text>
            <View style={{ marginTop: 12 }}>
              <Text style={styles.debugLinha}>Versão do app: {Constants.expoConfig?.version ?? '—'}</Text>
              <Text style={styles.debugLinha}>Canal: {Updates.channel ?? '—'}</Text>
              <Text style={styles.debugLinha}>Runtime version: {Updates.runtimeVersion ?? '—'}</Text>
              <Text style={styles.debugLinha}>
                Update OTA: {Updates.updateId ?? 'nenhum (rodando build embutido)'}
              </Text>
              <Text style={styles.debugLinha}>
                Publicado em: {Updates.createdAt ? Updates.createdAt.toLocaleString('pt-BR') : '—'}
              </Text>
              <Text style={styles.debugLinha}>É build embutido: {Updates.isEmbeddedLaunch ? 'sim' : 'não'}</Text>
            </View>
            <Pressable
              style={[styles.debugBotaoChecar, checandoUpdate && { opacity: 0.7 }]}
              onPress={async () => {
                Alert.alert('Checando...', 'Botão pressionado, iniciando checagem.');
                setChecandoUpdate(true);
                setStatusUpdateDebug('');
                const resultado = await verificarAtualizacaoOTA();
                setStatusUpdateDebug(resultado);
                setChecandoUpdate(false);
                Alert.alert('Resultado', resultado);
              }}
              disabled={checandoUpdate}
            >
              {checandoUpdate
                ? <ActivityIndicator color={C.branco} size="small" />
                : <Text style={styles.debugBotaoTexto}>Checar atualização agora</Text>
              }
            </Pressable>
            {statusUpdateDebug ? (
              <Text style={styles.debugStatus}>{statusUpdateDebug}</Text>
            ) : null}
            <Pressable
              style={styles.debugBotaoFechar}
              onPress={() => setModalDebugVisivel(false)}
            >
              <Text style={styles.debugBotaoFecharTexto}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  dicaCancelar: {
    color: C.cinzaTexto,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
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

  // ── rodapé de versão / debug de update OTA ──────────────
  rodapeVersao: {
    fontSize: 10,
    color: C.cinzaTexto,
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.6,
  },
  debugContainer: {
    width: '85%',
    backgroundColor: C.branco,
    borderRadius: 16,
    padding: 20,
  },
  debugLinha: {
    fontSize: 13,
    color: C.preto,
    marginBottom: 6,
    lineHeight: 18,
  },
  debugBotaoChecar: {
    marginTop: 16,
    backgroundColor: C.azul,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  debugBotaoTexto: {
    color: C.branco,
    fontWeight: '700',
    fontSize: 14,
  },
  debugStatus: {
    marginTop: 12,
    fontSize: 12,
    color: C.cinzaTexto,
    lineHeight: 17,
    textAlign: 'center',
  },
  debugBotaoFechar: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  debugBotaoFecharTexto: {
    color: C.cinzaTexto,
    fontSize: 13,
    fontWeight: '600',
  },
});