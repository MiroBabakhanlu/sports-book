const { default: axios } = require("axios");

const URL = '/api/leagues';

// const fetchApi = async () => {
//     try {
//         const response = await axios.get('http://localhost:8080/api/leagues/all');
//         console.log(response.data)
//     } catch (error) {
//         console.log(error)
//     }
// }



const fetchApi = async (regionCode) => {
    try {
        const response = await axios.get(`http://localhost:8080/api/bookmakers/bookmaker/${regionCode}`);
        console.log(response.data)
    } catch (error) {
        console.log(error)
    }
}

fetchApi('AM');