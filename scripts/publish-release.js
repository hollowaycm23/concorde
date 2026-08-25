require('dotenv').config();
const { execSync } = require('child_process');
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const OWNER = 'seu-usuario';
const REPO = 'discord-clone';

async function publish() {
  console.log('🚀 Publicando nova versão...\n');

  // 1. Lê versão do package.json
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const version = pkg.version;
  console.log(`📦 Versão: ${version}\n`);

  // 2. Build
  console.log('🔨 Fazendo build...');
  execSync('npm run build:win', { stdio: 'inherit' });

  // 3. Cria tag e release no GitHub
  console.log('\n📝 Criando release no GitHub...');
  
  const release = await octokit.repos.createRelease({
    owner: OWNER,
    repo: REPO,
    tag_name: `v${version}`,
    name: `Discord Clone v${version}`,
    body: generateChangelog(version),
    draft: false,
    prerelease: false
  });

  console.log(`✅ Release criada: ${release.data.html_url}\n`);

  // 4. Upload dos arquivos
  const distDir = 'dist';
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.exe') || f.endsWith('.blockmap'));

  for (const file of files) {
    const filePath = path.join(distDir, file);
    const fileData = fs.readFileSync(filePath);
    
    console.log(`📤 Enviando: ${file}`);
    
    await octokit.repos.uploadReleaseAsset({
      owner: OWNER,
      repo: REPO,
      release_id: release.data.id,
      name: file,
      data: fileData
    });
  }

  console.log('\n✅ Todos os arquivos enviados!');
  console.log(`\n🎉 Versão ${version} publicada com sucesso!`);
  console.log(`🔗 URL: ${release.data.html_url}`);
}

function generateChangelog(version) {
  // Tenta ler CHANGELOG.md se existir
  if (fs.existsSync('CHANGELOG.md')) {
    const content = fs.readFileSync('CHANGELOG.md', 'utf8');
    const match = content.match(new RegExp(`## \\[?${version}\\]?(.*?)(?=## \\[|$)`, 's'));
    if (match) return match[1].trim();
  }
  
  return `## O que há de novo na versão ${version}\n\n- Correções de bugs\n- Melhorias de performance\n- Novos recursos`;
}

publish().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});