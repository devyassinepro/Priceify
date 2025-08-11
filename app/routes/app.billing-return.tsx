import { LoaderFunctionArgs, redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log(`🔄 Billing return URL: ${url.toString()}`);

  // ✅ SIMPLE: Attendre 3 secondes puis rediriger vers l'app avec trigger de sync
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🎉 Payment Successful!</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          text-align: center;
          padding: 2rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0;
        }
        .container {
          background: rgba(255, 255, 255, 0.1);
          padding: 3rem;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          max-width: 500px;
        }
        .spinner {
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top: 4px solid white;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
          margin: 2rem auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .step {
          margin: 1rem 0;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          opacity: 0.7;
          transition: opacity 0.3s ease;
        }
        .step.active {
          opacity: 1;
          background: rgba(255, 255, 255, 0.2);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎉 Payment Successful!</h1>
        <p>Your subscription has been approved by Shopify!</p>
        
        <div class="spinner"></div>
        
        <div class="step" id="step1">✅ Payment confirmed</div>
        <div class="step" id="step2">🔄 Syncing subscription...</div>
        <div class="step" id="step3">🚀 Redirecting to your app...</div>
        
        <p style="font-size: 0.9em; margin-top: 2rem; opacity: 0.8;">
          This should only take a few seconds...
        </p>
      </div>
      
      <script>
        let step = 1;
        
        function activateStep(stepNum) {
          document.getElementById('step' + stepNum).classList.add('active');
        }
        
        // Étape 1: Paiement confirmé (immédiat)
        activateStep(1);
        
        // Étape 2: Sync (après 1 seconde)
        setTimeout(() => {
          activateStep(2);
        }, 1000);
        
        // Étape 3: Redirection (après 3 secondes)
        setTimeout(() => {
          activateStep(3);
          
          // Rediriger vers l'app avec trigger de sync
          const returnUrl = '/app?billing_completed=1&sync_needed=1';
          console.log('Redirecting to:', returnUrl);
          
          if (window.top) {
            window.top.location.href = returnUrl;
          } else {
            window.location.href = returnUrl;
          }
        }, 3000);
        
        // Fallback si la redirection échoue
        setTimeout(() => {
          if (window.location.pathname === '/billing-return') {
            window.location.href = '/app';
          }
        }, 8000);
      </script>
    </body>
    </html>
  `, {
    headers: {
      'Content-Type': 'text/html',
    },
  });
};

export default function BillingReturn() {
  // Cette page ne devrait jamais s'afficher car le loader retourne une Response HTML
  return null;
}