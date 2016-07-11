package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/aymerick/raymond"
	"github.com/fatih/structs"
	"github.com/gin-gonic/gin"
	//"github.com/nemith/tvmaze"
	//"github.com/tehjojo/go-newznab/newznab"
	"github.com/matthiassb/go-tvmaze/tvmaze"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"strconv"
	"strings"
	"regexp"
)

func downloadFile(url string, filepath string) (err error) {

	// Create the file
	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	// Get the data
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Writer the body to file
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	return nil
}

func getContentType(s string) string {
	if strings.HasSuffix(s, ".css") {
		return "text/css"
	} else if strings.HasSuffix(s, ".js") {
		return "application/javascript"
	} else if strings.HasSuffix(s, ".gif") {
		return "image/gif"
	} else if strings.HasSuffix(s, ".png") {
		return "image/png"
	}
	return "application/octet-stream"
}

var configFile = flag.String("config", "", "config file")

type Configuration struct {
	DataDirectory string
	DownloadDirectory string
	NewzNab []struct {
        Url string
				Key string
				Ssl bool
    }
}

type ShowFull struct {
	ShowInfo	*tvmaze.Show
	Episodes	[]tvmaze.Episode
}

type AllShows struct {
	Shows []ShowFull
}

func main() {

	flag.Parse()
	if *configFile == "" {
		fmt.Println("Config file not specified")
		return
	}
	file, err := os.Open(*configFile)
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	decoder := json.NewDecoder(file)
	configuration := Configuration{}
	err = decoder.Decode(&configuration)
	if err != nil {
		fmt.Println("Error parsing config:", err)
		return
	}

	err = os.MkdirAll(configuration.DataDirectory, 0777)
	if err != nil {
		fmt.Println(err)
		return
	}

	files, err := ioutil.ReadDir(configuration.DataDirectory)
	if err != nil {
		fmt.Println(err)
		return
	}

	AllShows := AllShows{}
	for _, file := range files {
		b, _ := ioutil.ReadFile(configuration.DataDirectory + "/" + file.Name() + "/" + file.Name() + ".json")
		sf := ShowFull{}
		json.Unmarshal(b, &sf)
		AllShows.Shows = append(AllShows.Shows, sf)
	}

	data, err := Asset("resources/views/partials/header.html")
	if err == nil {
		raymond.RegisterPartial("header", string(data))
	}
	data, err = Asset("resources/views/partials/footer.html")
	if err == nil {
		raymond.RegisterPartial("footer", string(data))
	}
	r := gin.Default()

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

	//router for all resource files
	r.GET("/assets/*file", func(c *gin.Context) {
		file := c.Param("file")
		data, err := Asset("resources/assets" + file)
		if err != nil {
			c.String(404, "404: Not Found")
		} else {
			c.Data(200, getContentType(file), data)
		}
	})

	//index router
	r.GET("/", func(c *gin.Context) {
		data, err := Asset("resources/views/layouts/libraries.html")
		fmt.Println(err)
		if err != nil {
			c.String(404, "404: Not Found")
		} else {
			tpl := raymond.MustParse(string(data))
			result := tpl.MustExec(nil)
			c.Data(200, "text/html", []byte(result))
		}
	})

	//display tv router
	r.GET("/media/tv", func(c *gin.Context) {
		data, err := Asset("resources/views/layouts/all-media.html")
		if err != nil {
			c.String(404, "404: Not Found")
		} else {
			ctx := structs.Map(AllShows)

			result, _ := raymond.Render(string(data), ctx)
			c.Data(200, "text/html", []byte(result))
		}
	})

	r.GET("/add-media", func(c *gin.Context) {
		data, err := Asset("resources/views/layouts/add-media.html")
		if err != nil {
			c.String(404, "404: Not Found")
		} else {
			tpl := raymond.MustParse(string(data))
			result := tpl.MustExec(nil)
			c.Data(200, "text/html", []byte(result))
		}
	})

	r.GET("/api/media/search", func(c *gin.Context) {
		term := c.Query("term")
		if term == "" {
			c.JSON(404, gin.H{
				"status":  404,
				"message": "No Series Found",
			})
		} else {
			shows, _ := tvmaze.DefaultClient.FindShows(term)

			if err != nil {
				fmt.Println(err)
			} else {
				if len(shows) == 0 {
					c.JSON(404, gin.H{
						"status":  404,
						"message": "No Shows Found",
					})
				}
				c.JSON(200, gin.H{
					"status":  200,
					"message": "Shows Found",
					"data":    shows,
				})
			}
		}
	})
	r.GET("/api/media/tv/:id", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		sf:= ShowFull{}
		seasons := make(map[string]int)

		for i := 0; i < len(AllShows.Shows); i++ {
			if AllShows.Shows[i].ShowInfo.ID == id {
				sf = AllShows.Shows[i]
				for j := 0; j < len(AllShows.Shows[i].Episodes); j++ {
					season := strconv.Itoa(AllShows.Shows[i].Episodes[j].Season)
					fmt.Println(seasons)
					seasons[season] = 1
				}
				sf.ShowInfo.SeasonCount = len(seasons)
			}
		}
		c.JSON(200, gin.H{
			"status": 200,
			"data": sf,
		})
	})
	r.GET("/media/tv/:id/:episode", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		episode, _ := strconv.Atoi(c.Param("episode"))
		seriesIndex := 0
		episodeIndex := 0
		data, err := Asset("resources/views/layouts/episode.html")
		if err != nil {
			c.String(404, "404: Not Found")
		} else {
			for i := 0; i < len(AllShows.Shows); i++ {
				if len(AllShows.Shows[i].Episodes) != 0 {
					if AllShows.Shows[i].ShowInfo.ID == id {
						seriesIndex = i
						for j := 0; j < len(AllShows.Shows[i].Episodes); j++ {

							episodeId := AllShows.Shows[i].Episodes[j].ID
							if episodeId == episode {
								episodeIndex = j
							}
						}
					}
				}
			}
			fmt.Println(seriesIndex)
			fmt.Println(episodeIndex)
			ctx := map[string]interface{}{
				"ShowInfo": AllShows.Shows[seriesIndex].ShowInfo,
				"Episode":  AllShows.Shows[seriesIndex].Episodes[episodeIndex],
			}
			result, err := raymond.Render(string(data), ctx)
			fmt.Println(err)
			c.Data(200, "text/html", []byte(result))
		}
	})
	r.GET("/data/:id/*file", func(c *gin.Context) {
		path := configuration.DataDirectory + "/" + c.Param("id") + "/" + c.Param("file")
		fmt.Println(path)
		if _, err := os.Stat(path); os.IsNotExist(err) {

			if match, _ := regexp.MatchString(".*sc-.*.jpg", path); match == true {

				data, err := Asset("resources/assets/img/default-sc.png")
				if err != nil {
					c.String(404, "404: Not Found")
				} else {
					c.Data(200, getContentType("resources/assets/img/default-sc.png"), data)
				}
			} else {
				c.File(path)
			}
		} else {
			c.File(path)
		}
	})
	r.GET("/api/media/tv/:id/season/:season", func(c *gin.Context) {
		id, _ := strconv.Atoi(c.Param("id"))
		season, _ := strconv.Atoi(c.Param("season"))

		index := 0
		episodeMap := make(map[string]tvmaze.Episode)
		for i := 0; i < len(AllShows.Shows); i++ {
			if len(AllShows.Shows[i].Episodes) != 0 {
				if AllShows.Shows[i].ShowInfo.ID == id {
					index = i
					for j := 0; j < len(AllShows.Shows[i].Episodes); j++ {

						epSeason := AllShows.Shows[i].Episodes[j].Season
						if season == epSeason {
							episodeMap[strconv.Itoa(AllShows.Shows[i].Episodes[j].Number)] = AllShows.Shows[i].Episodes[j]
						}
					}
				}
			}
		}

		c.JSON(200, gin.H{
			"status":     200,
			"ShowInfo": AllShows.Shows[index].ShowInfo,
			"Episodes":   episodeMap,
		})
	})
	r.POST("/api/download", func(c *gin.Context) {
		//client := newznab.New(configuration.NewzNab[0].Url, configuration.NewzNab[0].Key, configuration.NewzNab[0].Ssl)
		//results, _ := client.SearchWithQuery(newznab.CategoryTVHD, 35048, 3, 1)
	})
	r.POST("/api/media/tv/:id", func(c *gin.Context) {
		id := c.Param("id")
		show, err := tvmaze.DefaultClient.GetShowWithID(id)
		if err != nil {
			c.JSON(500, gin.H{
				"status":  500,
				"message": "Internal Server Error: " + err.Error(),
			})
			return
		}

		episodes, err := tvmaze.DefaultClient.GetEpisodes(*show)
		if err != nil {
			c.JSON(500, gin.H{
				"status":  500,
				"message": "Internal Server Error: " + err.Error(),
			})
			return
		}
		fullShow := ShowFull{ShowInfo: show, Episodes: episodes}

		convID := strconv.Itoa(fullShow.ShowInfo.ID)
		_ = os.MkdirAll(configuration.DataDirectory+"/"+convID, 0777)

		//download poster
		downloadFile(fullShow.ShowInfo.Image.Original, configuration.DataDirectory+"/"+convID+"/poster.jpg")
		downloadFile(fullShow.ShowInfo.Image.Medium, configuration.DataDirectory+"/"+convID+"/medium.jpg")
		fullShow.ShowInfo.Image.Original = "/data/"+convID+"/poster.jpg"
		fullShow.ShowInfo.Image.Medium = "/data/"+convID+"/medium.jpg"

		for i := 0; i < len(fullShow.Episodes); i++ {
			epId := strconv.Itoa(fullShow.Episodes[i].ID)
			_ = os.MkdirAll(configuration.DataDirectory+"/"+convID +"/"+epId, 0777)
			//fmt.Println(len(fullShow.Episodes[i].Image.Original))
			if len(fullShow.Episodes[i].Image.Original) > 0 {
				go downloadFile(fullShow.Episodes[i].Image.Original, configuration.DataDirectory+"/"+convID+"/"+epId+"/sc-original.jpg")
				go downloadFile(fullShow.Episodes[i].Image.Medium, configuration.DataDirectory+"/"+convID+"/"+epId+"/sc-medium.jpg")
			}

			fullShow.Episodes[i].Image.Original = "/data/"+convID+"/"+epId+"/sc-original.jpg"
			fullShow.Episodes[i].Image.Medium = "/data/"+convID+"/"+epId+"/sc-medium.jpg"
		}
		s, err := json.Marshal(fullShow)
		if err != nil {
			c.JSON(500, gin.H{
				"status":  500,
				"message": "Internal Server Error: " + err.Error(),
			})
			return
		}
		ioutil.WriteFile(configuration.DataDirectory+"/"+convID+"/"+convID+".json", s, 0644)
		AllShows.Shows = append(AllShows.Shows, fullShow)
		c.JSON(200, gin.H{
			"status":  200,
			"message": "Series Added",
		})
	})

	r.Run(":9090")
}
