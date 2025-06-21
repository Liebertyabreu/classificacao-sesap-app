// Importar os módulos Firebase necessários
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, onSnapshot, query, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// A classe FirebaseSESAPDatabase gerencia toda a interação com o Firebase Firestore.
// Ela encapsula a lógica de inicialização, autenticação, adição, recuperação,
// exclusão e restauração de dados, além de manter um array local sincronizado
// com o banco de dados em tempo real através de onSnapshot.
class FirebaseSESAPDatabase {
    constructor() {
        this.app = null;       // Instância do Firebase App
        this.auth = null;      // Instância do Firebase Auth
        this.db = null;        // Instância do Firebase Firestore
        this.userId = null;    // ID do usuário autenticado (anonimamente ou com token)
        // ID do aplicativo, obtido de uma variável global fornecida pelo ambiente (Canvas)
        this.appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        // Array local para armazenar uma cópia dos candidatos. Sincronizado pelo listener do Firestore.
        this.allCandidates = [];
        // Flag para indicar se a autenticação e a conexão com o Firestore estão prontas
        this.isAuthReady = false;
        
        // Inicia o processo de inicialização assíncrona do Firebase quando a classe é instanciada
        this.initializeFirebase();
    }

    // Método assíncrono para inicializar o Firebase.
    // Conecta-se ao Firebase, autentica o usuário e configura o listener de dados.
    async initializeFirebase() {
        try {
            // Analisa a configuração do Firebase, que é esperada como uma string JSON global
            const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
            
            // Inicializa o aplicativo Firebase
            this.app = initializeApp(firebaseConfig);
            // Obtém as instâncias dos serviços de autenticação e Firestore
            this.auth = getAuth(this.app);
            this.db = getFirestore(this.app);

            // Tenta autenticar o usuário. Prioriza o token personalizado (__initial_auth_token)
            // para sessões autenticadas, caso contrário, autentica anonimamente.
            if (typeof __initial_auth_token !== 'undefined') {
                await signInWithCustomToken(this.auth, __initial_auth_token);
            } else {
                await signInAnonymously(this.auth);
            }
            
            // Define o ID do usuário (UID do Firebase ou um UUID gerado aleatoriamente para usuários anônimos)
            this.userId = this.auth.currentUser?.uid || crypto.randomUUID();
            // Marca a autenticação como pronta
            this.isAuthReady = true;
            console.log("Firebase inicializado. ID do Usuário:", this.userId);
            
            // Uma vez que o Firebase está pronto e o usuário autenticado, configura o listener de dados
            this._setupCandidatesListener();
            
        } catch (error) {
            // Em caso de erro na inicialização, registra no console
            console.error("Erro ao inicializar Firebase:", error);
            // Aqui você poderia adicionar uma notificação visual ao usuário
        }
    }

    // Configura o listener em tempo real (onSnapshot) para a coleção de candidatos.
    // Garante que o array local 'allCandidates' esteja sempre sincronizado com o Firestore.
    _setupCandidatesListener() {
        // Verifica se a autenticação está pronta antes de configurar o listener
        if (!this.isAuthReady) {
            console.warn("Firestore não está pronto para configurar listener. Aguardando autenticação.");
            return;
        }
        // Define a referência da coleção de candidatos. O caminho inclui o appId e o userId
        // para isolar os dados por aplicativo e por usuário.
        const candidatesCollectionRef = collection(this.db, `artifacts/${this.appId}/users/${this.userId}/candidates`);
        
        // onSnapshot: Observa a coleção em tempo real.
        // O callback é executado inicialmente e sempre que houver uma mudança nos documentos da coleção.
        onSnapshot(candidatesCollectionRef, (snapshot) => {
            this.allCandidates = []; // Limpa o array local para recarregar os dados
            snapshot.forEach((doc) => {
                // Para cada documento no snapshot, adiciona seus dados e ID ao array local
                this.allCandidates.push({ id: doc.id, ...doc.data() });
            });
            console.log("Dados do Firestore atualizados localmente:", this.allCandidates);
            // Dispara um evento personalizado para notificar a UI de que os dados foram atualizados
            this._dispatchDataUpdateEvent();
        }, (error) => {
            // Em caso de erro no listener, registra no console
            console.error("Erro ao receber atualizações do Firestore:", error);
            // Aqui você poderia adicionar uma notificação visual de erro
        });
    }

    // Dispara um evento CustomEvent 'firebaseDataUpdated' no objeto document.
    // Isso permite que outros scripts na página (a UI) reajam às atualizações de dados do Firebase.
    _dispatchDataUpdateEvent() {
        const event = new CustomEvent('firebaseDataUpdated');
        document.dispatchEvent(event);
    }

    // Adiciona um novo candidato ao Firestore.
    async addCandidate(region, candidate) {
        // Verifica se o Firebase está pronto para operações de escrita
        if (!this.isAuthReady) {
            console.error("Firestore não está pronto. Candidato não adicionado.");
            return false;
        }
        try {
            const candidatesCollectionRef = collection(this.db, `artifacts/${this.appId}/users/${this.userId}/candidates`);
            await addDoc(candidatesCollectionRef, {
                ...candidate, // Espalha as propriedades do objeto candidato (nome, pontuacao, tipo)
                region: region, // Adiciona a região do candidato
                timestamp: new Date().toISOString() // Adiciona um timestamp de criação
            });
            console.log(`Candidato adicionado no Firestore:`, candidate);
            return true;
        } catch (e) {
            console.error("Erro ao adicionar candidato ao Firestore: ", e);
            return false;
        }
    }

    // Retorna os candidatos filtrados por região e tipo de vaga do array local 'allCandidates'.
    // Os dados são pré-ordenados por pontuação.
    getRegionData(region) {
        // Filtra todos os candidatos para a região especificada
        const candidatesForRegion = this.allCandidates.filter(c => c.region == region);
        const regionData = { ampla: [], pcd: [], ppp: [] };

        // Para cada tipo de vaga, filtra e ordena os candidatos da região
        ['ampla', 'pcd', 'ppp'].forEach(tipo => {
            regionData[tipo] = candidatesForRegion
                                .filter(c => c.tipo === tipo)
                                .sort((a, b) => b.pontuacao - a.pontuacao);
        });
        return regionData;
    }

    // Retorna uma cópia de todos os candidatos atualmente no array local 'allCandidates'.
    getAllData() {
        return JSON.parse(JSON.stringify(this.allCandidates)); // Retorna uma cópia profunda
    }

    // Exclui todos os documentos de candidatos do Firestore para o usuário atual.
    async clearAll() {
        if (!this.isAuthReady) {
            console.error("Firestore não está pronto. Não é possível limpar os dados.");
            return false;
        }
        try {
            const candidatesCollectionRef = collection(this.db, `artifacts/${this.appId}/users/${this.userId}/candidates`);
            const q = query(candidatesCollectionRef);
            const querySnapshot = await getDocs(q); // Obtém todos os documentos

            const deletePromises = [];
            querySnapshot.forEach((doc) => {
                deletePromises.push(deleteDoc(doc.ref)); // Adiciona uma promessa de exclusão para cada documento
            });
            await Promise.all(deletePromises); // Espera todas as exclusões serem concluídas
            console.log("Todos os dados foram limpos no Firestore.");
            return true;
        } catch (e) {
            console.error("Erro ao limpar dados do Firestore: ", e);
            return false;
        }
    }

    // Restaura dados a partir de um JSON. Limpa os dados existentes e adiciona os novos.
    async restoreData(jsonData) {
        if (!this.isAuthReady) {
            console.error("Firestore não está pronto. Não é possível restaurar os dados.");
            return false;
        }
        try {
            const dataToRestore = JSON.parse(jsonData);
            
            if (!dataToRestore || !Array.isArray(dataToRestore)) {
                console.error('Formato de arquivo inválido. Esperado um array de candidatos.');
                return false;
            }

            // Limpa todos os dados existentes antes de iniciar a restauração
            await this.clearAll();

            const candidatesCollectionRef = collection(this.db, `artifacts/${this.appId}/users/${this.userId}/candidates`);
            const addPromises = [];
            
            // Itera sobre os dados a serem restaurados e adiciona cada candidato ao Firestore
            for (const candidate of dataToRestore) {
                // Validação básica dos campos obrigatórios do candidato
                if (candidate.nome && candidate.pontuacao !== undefined && candidate.tipo && candidate.region) {
                    addPromises.push(addDoc(candidatesCollectionRef, {
                        nome: candidate.nome,
                        pontuacao: parseFloat(candidate.pontuacao),
                        tipo: candidate.tipo,
                        region: candidate.region,
                        timestamp: candidate.timestamp || new Date().toISOString() // Usa timestamp existente ou cria um novo
                    }));
                } else {
                    console.warn("Candidato inválido no arquivo de restauração, pulando:", candidate);
                }
            }
            await Promise.all(addPromises); // Espera todas as adições serem concluídas
            console.log('Dados restaurados com sucesso no Firestore!');
            return true;
        } catch (e) {
            console.error("Erro ao restaurar dados no Firestore: ", e);
            return false;
        }
    }

    // Exporta todos os candidatos locais para uma string JSON formatada.
    exportJSON() {
        return JSON.stringify(this.allCandidates, null, 2);
    }

    // Exporta todos os candidatos locais para uma string CSV.
    exportCSV() {
        let csv = 'Região,Nome,Pontuação,Tipo,Data/Hora\n';
        this.allCandidates.forEach(candidato => {
            const tipoName = candidato.tipo === 'ampla' ? 'Ampla Concorrência' : 
                           candidato.tipo === 'pcd' ? 'PCD' : 'PPP';
            csv += `${candidato.region},"${candidato.nome}",${candidato.pontuacao},${tipoName},${candidato.timestamp}\n`;
        });
        return csv;
    }
}
