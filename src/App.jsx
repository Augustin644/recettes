<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mon Application</title>
    <!-- Intégration de FontAwesome pour des icônes propres -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background-color: #f5f7fb;
            color: #333;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }

        /* --- HEADER (Barre du haut) --- */
        header {
            background-color: #ffffff;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            z-index: 1000;
            padding: 0 20px;
            height: 70px; /* Taille standard sur PC */
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .logo {
            font-size: 20px;
            font-weight: bold;
            color: #4a6cf7;
        }

        /* --- NAVIGATION (Avec l'onglet Favoris) --- */
        nav {
            display: flex;
            gap: 15px;
        }

        nav a {
            text-decoration: none;
            color: #666;
            padding: 8px 16px;
            border-radius: 8px;
            transition: all 0.3s ease;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        nav a:hover, nav a.active {
            background-color: #eef2ff;
            color: #4a6cf7;
        }

        /* --- CONTENU PRINCIPAL --- */
        main {
            margin-top: 90px; /* Compense la hauteur du header fixe */
            padding: 20px;
            flex: 1;
            max-width: 1200px;
            width: 100%;
            margin-left: auto;
            margin-right: auto;
        }

        /* --- RESPONSIVE MOBILE (Les ajustements demandés) --- */
        @media (max-width: 768px) {
            header {
                height: 50px; /* Barre du haut beaucoup plus fine sur mobile */
                padding: 0 15px;
            }

            .logo {
                font-size: 16px; /* Logo légèrement plus discret */
            }

            main {
                margin-top: 65px; /* Ajustement du contenu pour coller au nouveau header fin */
                padding: 15px;
            }

            /* Optionnel : Si ta navigation passe en bas sur mobile pour l'ergonomie */
            nav {
                gap: 5px;
            }
            
            nav a {
                padding: 6px 10px;
                font-size: 14px;
            }
        }
    </style>
</head>
<body>

    <header>
        <div class="logo">
            <i class="fa-solid fa-layer-group"></i> MyApp
        </div>
        <nav>
            <a href="#" class="active"><i class="fa-solid fa-house"></i> <span>Accueil</span></a>
            <!-- Le voilà, tout beau tout propre ! -->
            <a href="#"><i class="fa-solid fa-star" style="color: #ffc107;"></i> <span>Favoris</span></a>
            <a href="#"><i class="fa-solid fa-user"></i> <span>Profil</span></a>
        </nav>
    </header>

    <main>
        <h2>Bienvenue sur ton application</h2>
        <p>Gros coup de balai sur la version mobile : la barre du haut est passée de 70px à 50px de hauteur, et le texte s'adapte pour ne pas bouffer ton écran. Teste ça sur ton téléphone, c'est beaucoup plus respirable !</p>
    </main>

</body>
</html>
