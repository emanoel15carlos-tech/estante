# Estante

**Site:** https://emanoel15carlos-tech.github.io/estante/

Biblioteca pessoal animada: estante giratória em 3D (Three.js), livros que saem da prateleira e abrem (GSAP), busca de livros no Google Books com reserva na Open Library e na BrasilAPI, e uma página para comparar as duas APIs com os seus próprios livros.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (normalmente http://localhost:5173).

- **Estante:** `http://localhost:5173/`
- **Comparar APIs:** `http://localhost:5173/comparar.html`

Para gerar a versão de publicação: `npm run build` (os arquivos saem em `dist/`, prontos para Netlify, Vercel, GitHub Pages ou qualquer hospedagem estática).

### Chave do Google Books (opcional)

A busca funciona sem chave, mas com cota menor. Para usar uma chave, copie `.env.example` para `.env` e preencha `VITE_GOOGLE_BOOKS_KEY` com uma chave da Books API criada no Google Cloud Console.

## Como a busca funciona

1. **Google Books** é consultado primeiro (melhor cobertura de edições brasileiras).
2. Se o termo for um **ISBN**, a **BrasilAPI** é consultada junto (ela busca na Câmara Brasileira do Livro, Mercado Editorial, Open Library e Google Books).
3. Se o Google achar menos de 3 livros, a **Open Library** completa a lista.
4. Ao escolher um livro, o que faltar é completado: capa pela Open Library (por ISBN) ou BrasilAPI, sinopse pela BrasilAPI ou pela página da obra na Open Library.
5. Sem capa em nenhuma fonte, a estante desenha uma capa com o título.

As categorias das APIs (em inglês) sugerem automaticamente uma das suas seções. Dá para trocar antes de adicionar ou criar uma seção nova, já com o nome traduzido.

A Open Library pede no máximo cerca de 1 consulta por segundo; o app respeita esse limite e guarda as respostas durante a sessão.

## Onde ficam os dados

Por enquanto, a coleção fica salva **no navegador** (localStorage): cada navegador tem a sua estante, e limpar os dados do site apaga os livros. Fotos de capa enviadas são reduzidas para caber.

Para ter contas de usuário e a estante sincronizada entre aparelhos, o próximo passo é trocar `src/lib/store.js` por um banco de dados (Supabase, por exemplo). O resto do app só usa as funções desse arquivo, então a troca fica concentrada nele.

## Estrutura

```
index.html            estante
comparar.html         comparação Google Books × Open Library
src/main.js           prateleiras, filtros, busca na estante
src/scene/bookcase.js estante giratória em Three.js
src/ui/bookView.js    livro aberto (animações GSAP)
src/ui/addBook.js     adicionar livro (busca nas APIs e cadastro manual)
src/compare.js        lógica da comparação
src/lib/apis.js       Google Books, Open Library e BrasilAPI
src/lib/categories.js categorias das APIs → seções
src/lib/store.js      coleção salva no navegador
src/lib/covers.js     capas: imagens, capa desenhada, upload
tests/                testes (npm test)
```

## Acessibilidade

- Todos os livros da estante 3D também estão nas prateleiras, que funcionam por teclado.
- `Esc` fecha o livro aberto e o painel de adicionar.
- Com "reduzir movimento" ativado no sistema, as animações ficam curtas e sem deslocamento.
