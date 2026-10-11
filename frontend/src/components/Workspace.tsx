import { CardsView } from './workspace/CardsView';
import { HomeView } from './workspace/HomeView';
import { KatalogView } from './workspace/KatalogView';
import { Sidebar } from './workspace/Sidebar';
import { SettingsView } from './workspace/SettingsView';
import { StudioView } from './workspace/StudioView';

export function Workspace() {
  return (
    <div className="appShell hidden" id="appShell">
      <Sidebar />
      <main className="mainPane">
        <HomeView />
        <StudioView />
        <CardsView />
        <KatalogView />
        <SettingsView />
      </main>
      <div id="workspaceLoading" className="workspaceLoading hidden" role="status" aria-live="polite">
        <div className="workspaceLoadingCard">
          <span className="loadingSpinner" aria-hidden="true" />
          <strong id="workspaceLoadingTitle">Ders yükleniyor</strong>
          <span id="workspaceLoadingMessage">Video ve sohbet geçmişi hazırlanıyor...</span>
        </div>
      </div>
    </div>
  );
}
