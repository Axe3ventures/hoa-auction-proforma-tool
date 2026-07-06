import "./globals.css";

export const metadata = {
  title: "HOA Auction ProForma",
  description: "Sliding-scale profit estimator for HOA foreclosure auction deals",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
