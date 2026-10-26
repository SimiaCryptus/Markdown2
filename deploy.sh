die() {
  echo "$1"
  exit 1
}

build() {
  pushd packages/core || die "Failed to enter packages/core"
  npm run check || die "Failed to build packages/core"
  popd
  pushd apps/pwa || die "Failed to enter apps/pwa"
  npm run build || die "Failed to build apps/pwa"
  popd
}

install() {
  pushd packages/core || die "Failed to enter packages/core"
  npm install || die "Failed to install packages/core"
  popd
  pushd apps/pwa || die "Failed to enter apps/pwa"
  npm install || die "Failed to install apps/pwa"
  popd
}

deploy() {
  aws s3 cp --recursive ./apps/pwa/dist/ s3://md2.cognotik.com/

  aws cloudfront create-invalidation \
    --distribution-id E3UVO0RWXFPSKR \
    --paths "/*"
}

install
build
deploy

