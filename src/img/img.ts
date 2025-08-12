import { OpenAIImg, OpenAIImgOptions } from "./openai-img.ts";

export abstract class Img {
  static openai(options: OpenAIImgOptions): OpenAIImg {
    return new OpenAIImg(options);
  }
}