import './global.css';
import { Sidebar } from '../components/Sidebar';

export const metadata = {
  title: 'AdTech Platform — Meta Ads Intelligence',
  description: 'Creative analytics, anomaly detection a CAPI monitoring pre Meta Ads',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
