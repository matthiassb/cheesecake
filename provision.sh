#!/usr/bin/env bash

echo "Setting Up VM. This may take some time...."

{
  sudo apt-get update
  sudo apt-get install -y python-software-properties git

  GOLANG_VERSION=1.6.2
  GOLANG_SRC=https://storage.googleapis.com/golang/go$GOLANG_VERSION.linux-amd64.tar.gz

  wget -c $GOLANG_SRC
  tar -xvf go$GOLANG_VERSION.linux-amd64.tar.gz
  mv go go$GOLANG_VERSION
  mkdir -p $HOME/projects/go/{bin,pkg,src}
  ln -s go$GOLANG_VERSION go
  echo export PATH="$PATH:$HOME/go/bin" >> ~/.profile
  echo export GOROOT=$HOME/go/ >> ~/.profile
  echo export GOBIN=$HOME/projects/go/bin >> ~/.profile

  #git clone https://github.com/zeniko/unarr && cd unarr
  #mkdir lzma920 && cd lzma920 && curl -L http://www.7-zip.org/a/lzma920.tar.bz2 | tar -xjvp && cd ..
  #curl -L http://zlib.net/zlib-1.2.8.tar.gz | tar -xzvp
  #curl -L http://www.bzip.org/1.0.6/bzip2-1.0.6.tar.gz | tar -xzvp
  #curl -L https://gist.githubusercontent.com/gen2brain/89fe506863be3fb139e8/raw/8783a7d81e22ad84944d146c5e33beab6dffc641/unarr-makefile.patch | patch -p1
  #CFLAGS="-DHAVE_7Z -DHAVE_ZLIB -DHAVE_BZIP2 -I./lzma920/C -I./zlib-1.2.8 -I./bzip2-1.0.6" make
  #sudo cp build/debug/libunarr.a /usr/lib && sudo cp unarr.h /usr/include

} &> /dev/null
echo "VM Setup Complete"
