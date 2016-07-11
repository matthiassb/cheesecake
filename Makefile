export PATH := /vagrant/bin:$(PATH)

BINDATAFLAGS = -o src/github.com/matthiassb/cheesecake/web.go
CURDIR = $(shell pwd)
GOPATH = "$(CURDIR)"

all: executable

debug: BINDATAFLAGS += -debug
debug: executable

executable:
	GOPATH=$(GOPATH) go-bindata $(BINDATAFLAGS) -prefix "src/github.com/matthiassb/cheesecake/" src/github.com/matthiassb/cheesecake/resources/...
	GOPATH=$(GOPATH) go build -o ./bin/cheesecake src/github.com/matthiassb/cheesecake/cheesecake.go src/github.com/matthiassb/cheesecake/web.go
