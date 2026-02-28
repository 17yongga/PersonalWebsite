#!/bin/bash
# PaperTrade Platform - Full Setup Script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 PaperTrade Platform Setup"
echo "=============================="
echo "Project directory: $PROJECT_DIR"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js v18+"
    exit 1
fi
echo "✅ Node.js $(node -v)"

if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 not found. Please install Python 3.10+"
    exit 1
fi
echo "✅ Python $(python3 --version)"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✅ npm $(npm -v)"

# Setup env file
echo ""
echo "📝 Setting up environment..."
ENV_FILE="$PROJECT_DIR/config/.env"
if [ ! -f "$ENV_FILE" ]; then
    cp "$PROJECT_DIR/config/.env.example" "$ENV_FILE"
    # Generate random JWT secret
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/change_me_to_random_string/$JWT_SECRET/" "$ENV_FILE"
    else
        sed -i "s/change_me_to_random_string/$JWT_SECRET/" "$ENV_FILE"
    fi
    echo "✅ Created .env file at $ENV_FILE"
    echo "⚠️  Remember to add your Alpaca API keys to $ENV_FILE"
else
    echo "✅ .env file already exists"
fi

# Setup backend
echo ""
echo "🔧 Setting up Node.js backend..."
cd "$PROJECT_DIR/server"
if [ -f "package.json" ]; then
    npm install
    mkdir -p data
    echo "✅ Backend dependencies installed"
else
    echo "⚠️  No package.json found in server/ — backend not yet built"
fi

# Setup Python quant engine
echo ""
echo "🐍 Setting up Python quant engine..."
cd "$PROJECT_DIR/quant"
if [ -f "requirements.txt" ]; then
    if [ ! -d "venv" ]; then
        python3 -m venv venv
        echo "✅ Created Python virtual environment"
    fi
    source venv/bin/activate
    pip install -r requirements.txt --quiet
    echo "✅ Python dependencies installed"
    deactivate
else
    echo "⚠️  No requirements.txt found in quant/ — quant engine not yet built"
fi

# Create data directories
echo ""
echo "📁 Creating data directories..."
mkdir -p "$PROJECT_DIR/server/data"
mkdir -p "$PROJECT_DIR/quant/data"
mkdir -p "$PROJECT_DIR/quant/logs"

echo ""
echo "=============================="
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Add Alpaca API keys to $ENV_FILE"
echo "  2. Start the backend: cd server && node src/index.js"
echo "  3. Run quant engine: cd quant && source venv/bin/activate && python main.py --help"
echo "  4. Open the frontend: open index.html (or serve via the backend)"
echo ""
