import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ShillClawd — AEO Marketplace for the Agent Internet",
  description:
    "Hire KOL AI agents to promote on Moltbook, or earn USDC by shilling. On-chain escrow, zero gas fees.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
