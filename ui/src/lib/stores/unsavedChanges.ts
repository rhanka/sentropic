import { writable } from 'svelte/store';

interface UnsavedChange {
  id: string;
  component: string;
  value: any;
  saveFunction: () => Promise<void>;
}

interface UnsavedChangesState {
  changes: UnsavedChange[];
  isBlocking: boolean;
}

const initialState: UnsavedChangesState = {
  changes: [],
  isBlocking: false
};

function createUnsavedChangesStore() {
  const { subscribe, set, update } = writable<UnsavedChangesState>(initialState);

  return {
    subscribe,
    
    // Ajouter une modification non sauvegardée
    addChange: (change: UnsavedChange) => {
      update(state => {
        const existingIndex = state.changes.findIndex(c => c.id === change.id);
        if (existingIndex >= 0) {
          // Mettre à jour la modification existante
          state.changes[existingIndex] = change;
        } else {
          // Ajouter une nouvelle modification
          state.changes.push(change);
        }
        state.isBlocking = state.changes.length > 0;
        return state;
      });
    },
    
    // Supprimer une modification (après sauvegarde)
    removeChange: (id: string) => {
      update(state => {
        state.changes = state.changes.filter(c => c.id !== id);
        state.isBlocking = state.changes.length > 0;
        return state;
      });
    },
    
    // Sauvegarder toutes les modifications
    saveAll: async () => {
      let currentState: UnsavedChangesState;
      subscribe(state => currentState = state)();
      const savePromises = currentState.changes.map(change => change.saveFunction());
      
      try {
        await Promise.all(savePromises);
        set(initialState);
        return true;
      } catch (error) {
        console.error('Failed to save all changes:', error);
        return false;
      }
    },
    
    // Vérifier s'il y a des modifications non sauvegardées
    hasUnsavedChanges: () => {
      let currentState: UnsavedChangesState;
      subscribe(state => currentState = state)();
      return currentState.changes.length > 0;
    },
    
    // Obtenir le nombre de modifications
    getChangeCount: () => {
      let currentState: UnsavedChangesState;
      subscribe(state => currentState = state)();
      return currentState.changes.length;
    },
    
    // Réinitialiser (après navigation forcée)
    reset: () => {
      set(initialState);
    }
  };
}

export const unsavedChangesStore = createUnsavedChangesStore();
