import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Blog Automation Studio', template: '%s · Blog Automation Studio' },
  description: 'Browser-driven blogging automation: ChatGPT web UI + WordPress admin via Playwright.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
