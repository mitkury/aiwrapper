import { OpenAIImg, type OpenAIImgOptions } from "./openai-img.js";

export abstract class Img {
  static openai(options: OpenAIImgOptions): OpenAIImg {
    return new OpenAIImg(options);
  }
}
