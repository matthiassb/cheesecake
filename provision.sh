#!/usr/bin/env bash

echo "Setting Up VM. This may take some time...."

{
  sudo apt-get update
  sudo apt-get install -y python-software-properties git

  GOLANG_VERSION=1.6.2
  GOLANG_SRC=https://storage.googleapis.com/golang/go$GOLANG_VERSION.linux-386.tar.gz

  wget -c $GOLANG_SRC
  tar -xvf go$GOLANG_VERSION.linux-386.tar.gz
  mv go go$GOLANG_VERSION
  mkdir -p $HOME/projects/go/{bin,pkg,src}
  ln -s go$GOLANG_VERSION go
  echo export PATH="$PATH:$HOME/go/bin" >> ~/.profile
  echo export GOROOT=$HOME/go/ >> ~/.profile
  echo export GOBIN=$HOME/projects/go/bin >> ~/.profile

} &> /dev/null
echo "VM Setup Complete"
