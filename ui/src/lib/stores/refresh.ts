import { writable } from 'svelte/store';
import { isAuthenticated } from './session';

export interface RefreshState {
  folders: boolean;
  useCases: boolean;
  companies: boolean;
  currentUseCase: string | null;
}

export const refreshState = writable<RefreshState>({
  folders: false,
  useCases: false,
  companies: false,
  currentUseCase: null
});

export class RefreshManager {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isActive = false;

  constructor() {
    // Démarrer automatiquement le gestionnaire
    this.start();
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    console.log('🔄 RefreshManager started');
  }

  stop() {
    this.isActive = false;
    // Nettoyer tous les intervalles
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals.clear();
    console.log('⏹️ RefreshManager stopped');
  }

  // Helper method to check if user is authenticated before running callbacks
  private async runCallbackIfAuthenticated(callback: () => Promise<void>): Promise<void> {
    // Check authentication status
    let authenticated = false;
    const unsubscribe = isAuthenticated.subscribe(auth => {
      authenticated = auth;
    });
    unsubscribe();
    
    if (!authenticated) {
      console.log('🔄 Skipping refresh callback - user not authenticated');
      return;
    }
    
    await callback();
  }

  // Actualiser les dossiers toutes les 2 secondes s'il y en a en génération
  startFoldersRefresh(callback: () => Promise<void>) {
    const key = 'folders';
    
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error('Error during folders refresh:', error);
      }
    }, 2000);
    
    this.intervals.set(key, interval);
    console.log('🔄 Started folders refresh interval');
  }

  // Actualiser les cas d'usage toutes les 2 secondes s'il y en a en génération
  startUseCasesRefresh(callback: () => Promise<void>) {
    const key = 'useCases';
    
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error('Error during use cases refresh:', error);
      }
    }, 2000);
    
    this.intervals.set(key, interval);
    console.log('🔄 Started use cases refresh interval');
  }

  // Actualiser les entreprises toutes les 2 secondes s'il y en a en enrichissement
  startCompaniesRefresh(callback: () => Promise<void>) {
    const key = 'companies';
    
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error('Error during companies refresh:', error);
      }
    }, 2000);
    
    this.intervals.set(key, interval);
    console.log('🔄 Started companies refresh interval');
  }

  // Actualiser un cas d'usage spécifique toutes les 2 secondes s'il est en génération
  startUseCaseDetailRefresh(useCaseId: string, callback: () => Promise<void>) {
    const key = `useCase-${useCaseId}`;
    
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error(`Error during use case ${useCaseId} refresh:`, error);
      }
    }, 2000);
    
    this.intervals.set(key, interval);
    refreshState.update(state => ({ ...state, currentUseCase: useCaseId }));
    console.log(`🔄 Started use case detail refresh for ${useCaseId}`);
  }

  // Actualiser une entreprise spécifique toutes les 2 secondes si elle est en enrichissement
  startCompanyDetailRefresh(companyId: string, callback: () => Promise<void>) {
    const key = `company-${companyId}`;
    
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error(`Error during company ${companyId} refresh:`, error);
      }
    }, 2000);
    
    this.intervals.set(key, interval);
    console.log(`🔄 Started company detail refresh for ${companyId}`);
  }

  // Arrêter un refresh spécifique
  stopRefresh(key: string) {
    const interval = this.intervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(key);
      console.log(`⏹️ Stopped refresh for ${key}`);
    }
  }

  // Arrêter tous les refreshes
  stopAllRefreshes() {
    this.intervals.forEach((interval, key) => {
      clearInterval(interval);
      console.log(`⏹️ Stopped refresh for ${key}`);
    });
    this.intervals.clear();
    refreshState.set({ folders: false, useCases: false, companies: false, currentUseCase: null });
  }

  // Méthode générique pour démarrer un refresh avec une clé personnalisée
  startRefresh(key: string, callback: () => Promise<void>, intervalMs: number = 2000) {
    // Arrêter l'intervalle existant s'il y en a un
    this.stopRefresh(key);
    
    const interval = setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        await this.runCallbackIfAuthenticated(callback);
      } catch (error) {
        console.error(`Error during ${key} refresh:`, error);
      }
    }, intervalMs);
    
    this.intervals.set(key, interval);
    console.log(`🔄 Started refresh for ${key}`);
  }

  // Vérifier si un refresh est actif
  isRefreshActive(key: string): boolean {
    return this.intervals.has(key);
  }

  // Obtenir la liste des refreshes actifs
  getActiveRefreshes(): string[] {
    return Array.from(this.intervals.keys());
  }
}

// Instance globale du gestionnaire de refresh
export const refreshManager = new RefreshManager();
